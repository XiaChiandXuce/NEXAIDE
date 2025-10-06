/**
 * PNG图片压缩脚本 - 将nexaide-logo.png缩小100倍
 * 基于Canvas API实现等比例缩放
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

async function compressLogo() {
    try {
        // 输入和输出文件路径
        const inputPath = path.join(__dirname, 'src', 'assets', 'nexaide-logo.png');
        const outputPath = path.join(__dirname, 'src', 'assets', 'nexaide-logo-compressed.png');
        
        console.log('开始压缩logo图片...');
        console.log('输入文件:', inputPath);
        
        // 加载原始图片
        const image = await loadImage(inputPath);
        console.log(`原始图片尺寸: ${image.width} x ${image.height}`);
        
        // 计算缩小后的尺寸（缩小100倍意味着面积缩小10000倍，所以宽高各缩小10倍）
        const scaleFactor = 0.1; // 缩小10倍，面积就是缩小100倍
        const newWidth = Math.round(image.width * scaleFactor);
        const newHeight = Math.round(image.height * scaleFactor);
        
        console.log(`压缩后尺寸: ${newWidth} x ${newHeight}`);
        
        // 创建canvas
        const canvas = createCanvas(newWidth, newHeight);
        const ctx = canvas.getContext('2d');
        
        // 设置高质量缩放
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // 绘制缩小后的图片
        ctx.drawImage(image, 0, 0, newWidth, newHeight);
        
        // 保存压缩后的图片
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(outputPath, buffer);
        
        console.log('压缩完成!');
        console.log('输出文件:', outputPath);
        
        // 显示文件大小对比
        const originalSize = fs.statSync(inputPath).size;
        const compressedSize = fs.statSync(outputPath).size;
        const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2);
        
        console.log(`原始文件大小: ${(originalSize / 1024).toFixed(2)} KB`);
        console.log(`压缩后大小: ${(compressedSize / 1024).toFixed(2)} KB`);
        console.log(`压缩率: ${compressionRatio}%`);
        
    } catch (error) {
        console.error('压缩过程中出现错误:', error);
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    compressLogo();
}

module.exports = compressLogo;