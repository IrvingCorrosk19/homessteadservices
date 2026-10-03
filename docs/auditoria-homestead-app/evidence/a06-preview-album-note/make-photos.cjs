const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const dir = process.argv[2];
(async () => {
  for (const [name, color, label] of [["photo1.jpg",[40,90,140],"FOTO-1"],["photo2.jpg",[140,70,40],"FOTO-2"],["photo3.jpg",[40,120,70],"FOTO-3"]]) {
    const svg = Buffer.from(`<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgb(${color.join(",")})"/><text x="80" y="820" font-size="96" fill="white" font-family="Arial">${label}</text></svg>`);
    await sharp(svg).jpeg({quality:92}).toFile(path.join(dir,"assets",name));
    console.log("wrote", name, fs.statSync(path.join(dir,"assets",name)).size);
  }
  const { brandedSocialSet } = require("./src/lib/content-images.ts");
})().catch(e=>{console.error(e); process.exit(1)});
