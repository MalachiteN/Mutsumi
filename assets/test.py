import os
import sys

try:
    from PIL import Image
except ImportError:
    print("错误: 未检测到 PIL/Pillow 库。请先运行: pip install Pillow")
else:
    def white_to_transparent(input_path, output_path=None):
        """将PNG图片中的纯白色像素转换为透明像素"""
        if not os.path.exists(input_path):
            print(f"错误: 找不到文件 '{input_path}'")
            return

        print(f"正在处理: {input_path} ...")
        img = Image.open(input_path).convert("RGBA")
        datas = img.getdata()

        new_data = []
        # 遍历像素，寻找纯白 (255, 255, 255)
        for item in datas:
            if item[0] == 255 and item[1] == 255 and item[2] == 255:
                new_data.append((255, 255, 255, 0)) # 设为透明
            else:
                new_data.append(item)

        img.putdata(new_data)
        
        # 如果未指定输出路径，默认在原文件名后加 _transparent
        if not output_path:
            f_name, f_ext = os.path.splitext(input_path)
            output_path = f"{f_name}_transparent.png"
            
        img.save(output_path, "PNG")
        print(f"成功! 输出文件已保存至: {output_path}")

    print("-" * 40)
    print("环境检查完毕。函数 'white_to_transparent' 已就绪。")
    print("请直接输入以下命令调用（替换为你自己的文件路径）:")
    print("white_to_transparent('image.png')")
    print("-" * 40)

white_to_transparent('sidebar-icon.png')
