import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# 配置
BASE_URL = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/"
OUTPUT_DIR = "."

# 从HTML解析出的文件列表
FILES = [
    "tree-sitter-bash.wasm",
    "tree-sitter-c.wasm",
    "tree-sitter-c_sharp.wasm",
    "tree-sitter-cpp.wasm",
    "tree-sitter-css.wasm",
    "tree-sitter-dart.wasm",
    "tree-sitter-elisp.wasm",
    "tree-sitter-elixir.wasm",
    "tree-sitter-elm.wasm",
    "tree-sitter-embedded_template.wasm",
    "tree-sitter-go.wasm",
    "tree-sitter-html.wasm",
    "tree-sitter-java.wasm",
    "tree-sitter-javascript.wasm",
    "tree-sitter-json.wasm",
    "tree-sitter-kotlin.wasm",
    "tree-sitter-lua.wasm",
    "tree-sitter-objc.wasm",
    "tree-sitter-ocaml.wasm",
    "tree-sitter-php.wasm",
    "tree-sitter-python.wasm",
    "tree-sitter-ql.wasm",
    "tree-sitter-rescript.wasm",
    "tree-sitter-ruby.wasm",
    "tree-sitter-rust.wasm",
    "tree-sitter-scala.wasm",
    "tree-sitter-solidity.wasm",
    "tree-sitter-swift.wasm",
    "tree-sitter-systemrdl.wasm",
    "tree-sitter-tlaplus.wasm",
    "tree-sitter-toml.wasm",
    "tree-sitter-tsx.wasm",
    "tree-sitter-typescript.wasm",
    "tree-sitter-vue.wasm",
    "tree-sitter-yaml.wasm",
    "tree-sitter-zig.wasm"
]

def download_file(filename):
    """下载单个文件的函数"""
    url = f"{BASE_URL}{filename}"
    filepath = os.path.join(OUTPUT_DIR, filename)
    
    try:
        print(f"Starting: {filename}...")
        # 设置 User-Agent 以防止被某些 CDN 拦截（虽然 unpkg 通常很宽松）
        req = urllib.request.Request(
            url, 
            data=None, 
            headers={'User-Agent': 'Mozilla/5.0 (compatible; TreeSitterDownloader/1.0)'}
        )
        
        with urllib.request.urlopen(req) as response, open(filepath, 'wb') as out_file:
            data = response.read()
            out_file.write(data)
            
        print(f"✅ Success: {filename}")
        return True
    except Exception as e:
        print(f"❌ Failed: {filename} - Error: {e}")
        return False

def main():
    # 1. 创建输出目录
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created directory: {OUTPUT_DIR}")

    print(f"Downloading {len(FILES)} files from {BASE_URL}...\n")

    # 2. 使用线程池并发下载 (建议并发数 5-10，以免对服务器造成过大压力)
    with ThreadPoolExecutor(max_workers=5) as executor:
        executor.map(download_file, FILES)

    print("\nAll tasks completed.")

if __name__ == "__main__":
    main()
