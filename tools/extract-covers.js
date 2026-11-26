/* Tách ảnh bìa base64 trong data/data.js thành file trong assets/covers/.
   Chạy lại sau mỗi lần đồng bộ data.js từ Google Drive: node tools/extract-covers.js */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data", "data.js");
const coverDir = path.join(root, "assets", "covers");
const source = fs.readFileSync(dataPath, "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const data = sandbox.window.SITE_DATA;
if (!data || !Array.isArray(data.songs) || !Array.isArray(data.anime)) {
  throw new Error("data/data.js không hợp lệ");
}

const slug = (value) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  .slice(0, 48) || "item";

fs.mkdirSync(coverDir, { recursive: true });
let extracted = 0;
for (const [kind, list] of [["song", data.songs], ["anime", data.anime]]) {
  list.forEach((item, i) => {
    const match = String(item.image || "").match(/^data:image\/([a-z0-9]+);base64,(.*)$/is);
    if (!match) return; // already a file path or external URL
    const ext = ({ jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp", gif: "gif" })[match[1].toLowerCase()] || "jpg";
    const bytes = Buffer.from(match[2], "base64");
    const hash = crypto.createHash("md5").update(bytes).digest("hex").slice(0, 8);
    const name = `${kind}-${slug(item.title)}-${hash}.${ext}`;
    fs.writeFileSync(path.join(coverDir, name), bytes);
    item.image = `assets/covers/${name}`;
    extracted++;
    process.stdout.write(`  ${kind} ${i + 1}: ${name}\n`);
  });
}

const header = "/** Dữ liệu xuất từ trang web Soricia. Thay nội dung data/data.js bằng file này. */\n";
fs.writeFileSync(dataPath, header + "window.SITE_DATA = " + JSON.stringify(data, null, 2) + ";\n");
console.log(`Đã tách ${extracted} ảnh sang assets/covers/. data.js giờ ${(fs.statSync(dataPath).size / 1024).toFixed(0)} KB.`);
