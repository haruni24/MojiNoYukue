import socket
import threading
import time

PORT = 5001

def send_loop(conn):
    """クライアントへ定期的にメッセージを送るスレッド用関数"""
    seq = 0
    try:
        while True:
            msg = f"Server alive {seq}\n"
            conn.sendall(msg.encode("utf-8"))
            seq += 1
            time.sleep(1.0)
    except (OSError, ConnectionError):
        pass

def receive_loop(conn):
    """クライアントからのメッセージを受信するスレッド用関数"""
    buf = b""
    try:
        while True:
            data = conn.recv(4096)
            if not data:
                print("[server] disconnected")
                break
            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if line:
                    print(f"[server] received: {line.decode('utf-8', errors='replace')}")
    except (OSError, ConnectionError):
        pass

def run_server():
    s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

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
        
        # 自動送信スレッドを開始 (Heartbeat)
        threading.Thread(target=send_loop, args=(conn,), daemon=True).start()
        # 受信スレッドを開始
        threading.Thread(target=receive_loop, args=(conn,), daemon=True).start()

        print("Type message and press Enter to send to client:")
        try:
            while True:
                msg = input()
                if msg:
                    conn.sendall((msg + "\n").encode("utf-8"))
        except (OSError, ConnectionError):
            print("[server] connection closed")
        finally:
            conn.close()

if __name__ == "__main__":
    run_server()
