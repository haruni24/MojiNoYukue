import socket
import time
import random
import threading

SERVER_IP = "240a:61:6c2c:75e7:1c15:d243:5cd2:149f"  # ←受信側MacのIPに変え
PORT = 5001
HZ = 30.0

def connect():
    s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    # keepalive（macOSでは一部はOS依存だけど、ONにしとく価値はある）
    s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)

    s.settimeout(5.0)
    s.connect((SERVER_IP, PORT))
    s.settimeout(None)
    print("[client] connected")
    return s

def receive_loop(sock):
    """サーバーからのメッセージを受信するスレッド用関数"""
    try:
        buf = b""
        while True:
            data = sock.recv(4096)
            if not data:
                break
            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if line:
                    print(f"[client] received: {line.decode('utf-8', errors='replace')}")
    except (OSError, ConnectionError):
        pass

def send_data_loop(sock):
    """座標データを定期的に送信するスレッド用関数"""
    dt = 1.0 / HZ
    seq = 0
    next_t = time.time()
    try:
        while True:
            ts = time.time()
            person_id = random.randint(1, 5)
            x = random.random() * 10
            y = random.random() * 10
            msg = f"DATA {ts:.6f} {seq} {person_id} {x:.3f} {y:.3f}\n"
            sock.sendall(msg.encode("utf-8"))
            seq += 1
            next_t += dt
            sleep = next_t - time.time()
            if sleep > 0:
                time.sleep(sleep)
    except (OSError, ConnectionError):
        pass

def run():
    while True:
        try:
            sock = connect()
            
            # 受信スレッドを開始
            threading.Thread(target=receive_loop, args=(sock,), daemon=True).start()
            # 自動送信スレッドを開始
            threading.Thread(target=send_data_loop, args=(sock,), daemon=True).start()

            print("Type message and press Enter to send (or 'exit' to quit):")
            while True:
                msg = input()
                if msg.lower() == 'exit':
                    return
                if msg:
                    sock.sendall((msg + "\n").encode("utf-8"))

        except (OSError, ConnectionError, socket.timeout) as e:
            print(f"[client] connection lost: {e} -> retry in 1s")
            time.sleep(1.0)

if __name__ == "__main__":
    run()
