# -*- coding: utf-8 -*-
"""
스마트 보이스 폴리셔 로컬 웹 서버
실행: python server.py
작성자: AI 개발부장 코다리 💻
"""
import http.server
import socketserver
import webbrowser
import os
import sys
from pathlib import Path

PORT = 8080
DIRECTORY = Path(__file__).parent.resolve()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)


def main():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("=" * 60)
    print(f"🎙️ [스마트 보이스 폴리셔 AI 웹 서버 기동]")
    print(f"📁 웹 루트 디렉터리: {DIRECTORY}")
    print(f"🔗 로컬 접속 주소: http://localhost:{PORT}")
    print("=" * 60)

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"✨ 브라우저에서 'http://localhost:{PORT}' 주소로 접속하세요.")
        print("💡 마이크 허용 팝업이 뜨면 [허용]을 눌러주시면 실시간 음성 인식이 작동합니다.")
        print("🛑 서버를 종료하려면 Ctrl + C 를 누르세요.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버가 정상적으로 종료되었습니다.")


if __name__ == "__main__":
    main()
