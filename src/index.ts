import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as cluster from "cluster";
import * as fs from "fs-extra";
import { getPid as getHostPid } from "first-officer";
import merge = require("lodash/merge");

export const isWin32 = process.platform == "win32";
export const usingPort = isWin32 && cluster.isWorker;

export class IPChannel {
    autoReconnect = true;

    constructor(private connectionListener: (socket: net.Socket) => void) { }

    /**
     * Gets a `net.Socket` instance connected to the server.
     * @param timeout Default value is `5000`ms.
     */
    async connect(timeout = 5000) {
        let socket = await this.getConnection(timeout);

        socket.on("error", async (err) => {
            if (this.autoReconnect && isSocketResetError(err)) {
                merge(socket, await this.getConnection(timeout));
            }
        });
    }

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
            pid = pid || await getHostPid();

            let addr = await this.getSocketAddr(pid),
                conn: net.Socket;

            conn = await this.tryConnect(addr);

            if (!conn && pid === process.pid)
                conn = await this.tryServe(pid, addr);

            conn ? resolve(conn) : this.retryConnect(resolve, reject, timeout, pid);
        });
    }
}

/** @param connectionListener A connection lister for `net.createServer()`. */
export function openChannel(connectionListener: (socket: net.Socket) => void) {
    return new IPChannel(connectionListener);
}

export function isSocketResetError(err) {
    return err instanceof Error
        && (err["code"] == "ECONNRESET"
            || /socket.*(ended|closed)/.test(err.message));
}

export default openChannel;