import socket
import time

HOST = "0.0.0.0"
PORT = 5001

def run_server():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((HOST, PORT))
        s.listen(1)
        print(f"[server] listening on {HOST}:{PORT}")

        while True:
            conn, addr = s.accept()
            print(f"[server] connected: {addr}")
            with conn:
                conn.settimeout(10.0)
                buf = b""
                while True:
                    try:
                        data = conn.recv(4096)
                        if not data:
                            print("[server] disconnected")
                            break
                        buf += data
                        # 1行 = 1フレーム で受ける
                        while b"\n" in buf:
                            line, buf = buf.split(b"\n", 1)
                            if line:
                                print(line.decode("utf-8", errors="replace"))
                    except socket.timeout:
                        # 何も来ない時間があっても落ちない
                        continue
                    except ConnectionError:
                        print("[server] connection error")
                        break

if __name__ == "__main__":
    run_server()
