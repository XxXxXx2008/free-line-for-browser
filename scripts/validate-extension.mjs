import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, "..");
const extensionDirectory = path.join(
  workspaceDirectory,
  "orange-split-extension",
);

const forbiddenExtensions = new Set([
  ".exe",
  ".sh",
  ".bat",
  ".cmd",
  ".php",
  ".jsp",
  ".py",
  ".map",
]);
const textExtensions = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".txt",
]);

const errors = [];
const warnings = [];
const files = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path
      .relative(extensionDirectory, absolutePath)
      .split(path.sep)
      .join("/");
    const stats = lstatSync(absolutePath);

    if (stats.isSymbolicLink()) {
      errors.push(`发现符号链接：${relativePath}`);
      continue;
    }
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath,
        size: statSync(absolutePath).size,
        extension: path.extname(entry.name).toLowerCase(),
      });
    }
  }
}

if (!existsSync(extensionDirectory)) {
  throw new Error(`扩展目录不存在：${extensionDirectory}`);
}

walk(extensionDirectory);

const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
if (files.length > 300) {
  errors.push(`文件数为 ${files.length}，超过 300。`);
}
if (totalBytes > 20_971_520) {
  errors.push(`扩展大小为 ${totalBytes} 字节，超过 20MB。`);
}

const caseMap = new Map();
for (const file of files) {
  const lowerName = file.relativePath.toLowerCase();
  if (caseMap.has(lowerName)) {
    errors.push(
      `存在大小写重名：${caseMap.get(lowerName)} / ${file.relativePath}`,
    );
  } else {
    caseMap.set(lowerName, file.relativePath);
  }

  if (forbiddenExtensions.has(file.extension)) {
    errors.push(`包含禁止文件：${file.relativePath}`);
  }
  if (file.relativePath.split("/").includes("..")) {
    errors.push(`包含上级目录路径：${file.relativePath}`);
  }

  if (!textExtensions.has(file.extension)) {
    continue;
  }

  const content = readFileSync(file.absolutePath, "utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    errors.push(`疑似包含私钥：${file.relativePath}`);
  }
  if (
    /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token)\b\s*[:=]\s*["'][^"']+["']/i.test(
      content,
    )
  ) {
    errors.push(`疑似包含硬编码密钥：${file.relativePath}`);
  }

  if (file.extension === ".html") {
    const externalResourcePattern =
      /<(?:script|link|img|source)\b[^>]*(?:src|href)=["'](https?:\/\/[^"']+)["']/gi;
    let match;
    while ((match = externalResourcePattern.exec(content))) {
      errors.push(
        `HTML 引用外部运行资源：${file.relativePath} -> ${match[1]}`,
      );
    }

    const localReferencePattern =
      /<(?:script|link|img|iframe|source)\b[^>]*(?:src|href)=["']([^"'#]+)["']/gi;
    while ((match = localReferencePattern.exec(content))) {
      const reference = match[1];
      if (
        /^(?:[a-z]+:|\/\/)/i.test(reference) ||
        reference.startsWith("data:")
      ) {
        continue;
      }
      const resolved = path.resolve(
        path.dirname(file.absolutePath),
        reference.split("?")[0],
      );
      if (!existsSync(resolved)) {
        errors.push(
          `引用文件不存在：${file.relativePath} -> ${reference}`,
        );
      }
    }
  }
}

const manifestPath = path.join(extensionDirectory, "manifest.json");
if (!existsSync(manifestPath)) {
  errors.push("缺少 manifest.json。");
} else {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    errors.push(`manifest.json 无法解析：${error.message}`);
  }

  if (manifest) {
    if (manifest.manifest_version !== 3) {
      errors.push("manifest_version 必须为 3。");
    }
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version || "")) {
      errors.push("manifest.version 格式无效。");
    }
    if (!manifest.action?.default_popup) {
      errors.push("缺少扩展弹出页入口。");
    } else if (
      !existsSync(
        path.join(extensionDirectory, manifest.action.default_popup),
      )
    ) {
      errors.push(`扩展弹出页不存在：${manifest.action.default_popup}`);
    }

    const iconReferences = new Set([
      ...Object.values(manifest.icons || {}),
      ...Object.values(manifest.action?.default_icon || {}),
    ]);
    for (const iconPath of iconReferences) {
      if (!existsSync(path.join(extensionDirectory, iconPath))) {
        errors.push(`图标不存在：${iconPath}`);
      }
    }

    const csp = manifest.content_security_policy?.extension_pages || "";
    if (!csp.includes("script-src 'self'")) {
      errors.push("扩展页 CSP 未限制脚本为本地资源。");
    }
    if (/\bunsafe-eval\b|\bunsafe-inline\b/.test(csp)) {
      errors.push("扩展页 CSP 包含不安全的脚本放行项。");
    }
    if (!csp.includes("frame-src")) {
      warnings.push("扩展页 CSP 未显式声明 frame-src。");
    }
    if (!manifest.host_permissions?.includes("<all_urls>")) {
      warnings.push("未申请全站 host 权限，部分 iframe 可能无法加载。");
    }

    for (const contentScript of manifest.content_scripts || []) {
      for (const scriptPath of contentScript.js || []) {
        if (!existsSync(path.join(extensionDirectory, scriptPath))) {
          errors.push(`内容脚本不存在：${scriptPath}`);
        }
      }
    }
  }
}

for (const requiredFile of [
  "split.html",
  "split.js",
  "geometry.mjs",
  "demo-a.html",
  "demo-b.html",
]) {
  if (!existsSync(path.join(extensionDirectory, requiredFile))) {
    errors.push(`缺少运行文件：${requiredFile}`);
  }
}

if (!files.some((file) => file.relativePath === "manifest.json")) {
  errors.push("扩展根目录必须直接包含 manifest.json。");
}

const report = {
  status: errors.length === 0 ? "passed" : "failed",
  extensionDirectory,
  fileCount: files.length,
  totalBytes,
  errors,
  warnings,
  files: files.map((file) => ({
    path: file.relativePath,
    bytes: file.size,
  })),
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exitCode = 1;
}
