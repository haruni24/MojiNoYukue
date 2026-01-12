import socket
import time
import random

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

def run():
    dt = 1.0 / HZ
    seq = 0

    while True:
        try:
            sock = connect()
            next_t = time.time()

            while True:
                # 送信例：timestamp, seq, id, x, y
                ts = time.time()
                person_id = random.randint(1, 5)
                x = random.random() * 10
                y = random.random() * 10

                msg = f"{ts:.6f} {seq} {person_id} {x:.3f} {y:.3f}\n"
                sock.sendall(msg.encode("utf-8"))
                seq += 1

                next_t += dt
                sleep = next_t - time.time()
                if sleep > 0:
                    time.sleep(sleep)

        except (OSError, ConnectionError, socket.timeout) as e:
            print(f"[client] connection lost: {e} -> retry in 1s")
            try:
                sock.close()
            except Exception:
                pass
            time.sleep(1.0)

if __name__ == "__main__":
    run()
