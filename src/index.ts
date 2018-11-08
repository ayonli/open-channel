import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as cluster from "cluster";
import * as fs from "fs-extra";
import { getManagerPid } from "manager-process";
import { EventEmitter } from 'events';

export const isWin32 = process.platform == "win32";
export const usingPort = isWin32 && cluster.isWorker;

export class IPChannel extends EventEmitter {
    socket: net.Socket;

    constructor(private connectionListener: (socket: net.Socket) => void, timeout = 5000) {
        super();
        let _this = this;

        (async function connect() {
            let isInit = !_this.socket;

            _this.socket = await _this.getConnection(timeout);
            _this.socket.on("connect", () => {
                // emit connect event when the first time establish connection.
                isInit && _this.emit("connect");
            }).on("close", async () => {
                // automatically re-connect when connection lost.
                await connect();
            }).on("error", err => {
                if (isSocketResetError(err)) {
                    _this.socket.destroyed || _this.socket.emit("close");
                } else {
                    _this.emit("error");
                }
            });
        })();
    }


    on(event: "connect" | "close", listener: () => void): this;
    on(event: "data", listener: (data: Buffer) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: string | symbol, listener: (...args) => void): this;
    on(...args) {
        return super.on.apply(this, args);
    }

    send(data: string | Buffer, cb: () => void): boolean {
        return this.connected && this.socket.write(<any>data, cb);
    }

    get connected() {
        return this.socket ? !this.socket.destroyed : false;
    }

    /**
     * Gets a `net.Socket` instance connected to the server.
     * @param timeout Default value is `5000`ms.
     */
    // async connect(timeout = 5000) {

    // }

    private async bind(pid: number) {
        let server = net.createServer(this.connectionListener);

        await new Promise(async (resolve, reject) => {
            server.once("error", (err) => {
                server.close();
                server.unref();

                // If the port is already in use, then throw the error, otherwise, 
                // just return null so that the program could retry.
                if (err["code"] == "EADDRINUSE") {
                    reject(err);
                } else {
                    resolve(null);
                }
            });

            if (usingPort) {
                server.listen(() => {
                    resolve(null);
                });
            } else {
                // bind to a Unix domain socket or Windows named pipe
                let path = <string>await this.getSocketAddr(pid);

                if (await fs.pathExists(path)) {
                    // When all the connection request run asynchronously, there is 
                    // no guarantee that this procedure will run as expected since 
                    // anther process may delete the file before the current 
                    // process do. So must put the 'unlink' operation in a 
                    // try...catch block, and when fail, it will not cause the 
                    // process to terminate.
                    try { await fs.unlink(path); } catch (e) { }
                }

                server.listen(path, () => {
                    resolve(null);
                });
            }
        });

        if (usingPort) {
            await this.setPort(pid, server.address()["port"]);
        }

        return server;
    }

    private async setPort(pid: number, port: number) {
        let dir = os.tmpdir() + "/.uipc",
            file = dir + "/" + pid;

        await fs.ensureDir(dir);
        await fs.writeFile(file, port, "utf8");
    }

    private async getSocketAddr(pid: number): Promise<string | number> {
        let dir = os.tmpdir() + "/.uipc",
            file = dir + "/" + pid;

        if (!usingPort) {
            await fs.ensureDir(dir);
            return !isWin32 ? file : path.join('\\\\?\\pipe', file);
        }

        try {
            let data = await fs.readFile(file, "utf8");
            return parseInt(data) || 0;
        } catch (err) {
            return 0;
        }
    }

    private tryConnect(addr: string | number): Promise<net.Socket> {
        return new Promise((resolve: (value: net.Socket) => void, reject) => {
            if (!addr)
                return resolve(null);

            let conn = net.createConnection(<any>addr);

            conn.once("error", (err) => {
                if (err["code"] == "ECONNREFUSED" || err["code"] == "ENOENT") {
                    resolve(null);
                } else {
                    reject(err);
                }
            }).once("connect", () => {
                resolve(conn);
            });
        });
    }

    private retryConnect(resolve, reject, timeout: number, pid: number) {
        let conn: net.Socket,
            retries = 0,
            maxRetries = Math.ceil(timeout / 50),
            timer = setInterval(async () => {
                retries++;
                conn = await this.getConnection(timeout, pid);

                if (conn) {
                    resolve(conn);
                    clearInterval(timer);
                } else if (retries === maxRetries) {
                    clearInterval(timer);
                    let err = new Error("failed to get connection after "
                        + Math.round(timeout / 1000) + " seconds timeout");
                    reject(err);
                }
            }, 50);
    }

    private async tryServe(pid: number, addr: string | number): Promise<net.Socket> {
        try {
            let server = await this.bind(pid);
            if (server) {
                let _addr = server.address();
                addr = typeof _addr == "object" ? _addr.port : _addr;
                return this.tryConnect(addr);
            }
        } catch (err) {
            if (err["code"] == "EADDRINUSE")
                return this.tryConnect(addr);
            else
                throw err;
        }
    }

    private getConnection(timeout = 5000, pid?: number) {
        return new Promise(async (resolve: (value: net.Socket) => void, reject) => {
            pid = pid || await getManagerPid();

            let addr = await this.getSocketAddr(pid),
                conn: net.Socket;

            conn = await this.tryConnect(addr);

            if (!conn && pid === process.pid)
                conn = await this.tryServe(pid, addr);

            conn ? resolve(conn) : this.retryConnect(resolve, reject, timeout, pid);
        });
    }
}

/**
 * @param connectionListener A connection listener for `net.createServer()`.
 * @param timeout Default value is `5000`ms.
 */
export function openChannel(connectionListener: (socket: net.Socket) => void, timeout = 5000) {
    return new IPChannel(connectionListener, timeout);
}

export function isSocketResetError(err) {
    return err instanceof Error
        && (err["code"] == "ECONNRESET"
            || /socket.*(ended|closed)/.test(err.message));
}

export default openChannel;