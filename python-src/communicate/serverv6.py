import socket

PORT = 5001

def run_server():
    s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    # macOSではデフォでV6ONLYになってることがあるので明示的にOFF
    try:
        s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    except OSError:
        pass

    s.bind(("::", PORT))
    s.listen(1)
    print(f"[server] listening on [::]:{PORT}")

    while True:
        conn, addr = s.accept()
        print(f"[server] connected: {addr}")
        with conn:
            buf = b""
            while True:
                data = conn.recv(4096)
                if not data:
                    print("[server] disconnected")
                    break
                buf += data
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if line:
                        print(line.decode("utf-8", errors="replace"))

if __name__ == "__main__":
    run_server()
