import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as cluster from "cluster";
import * as fs from "fs-extra";
import { getManagerPid } from "manager-process";

export const isWin32 = process.platform == "win32";
export const usingPort = isWin32 && cluster.isWorker;

export class IPChannel {
    private closed = false;
    private managerPid: number;
    private retries: number = 0;
    private queue: any[][] = [];
    private socket: net.Socket;

    constructor(private connectionListener: (socket: net.Socket) => void) { }

    close() {
        this.closed = true;
        this.socket.destroy();
    }

    get connected() {
        return this.socket
            ? !this.socket.destroyed && !this.socket.connecting
            : false;
    }

    connect(timeout = 5000) {
        this.socket = new net.Socket();

        var write = this.socket.write;
        var maxRetries = Math.ceil(timeout / 50);

        this.socket.write = (...args) => {
            // if the connection is ready, send message immediately, otherwise
            // push them into a queue.
            return this.connected
                ? write.apply(this.socket, args)
                : !!this.queue.push(args);
        }

        this.socket.on("connect", () => {
            this.retries = 0;

            // send out queued messages
            let args: any[];
            while (args = this.queue.shift()) {
                this.socket.write.apply(this.socket, args);
            }
        }).on("error", async (err) => {
            if (err["code"] == "ECONNREFUSED" || err["code"] == "ENOENT") {
                if (this.retries < maxRetries) {
                    // retry connect
                    this.retries++;
                    await this.tryConnect(this.managerPid);
                }
            } else if (this.isSocketResetError(err)) {
                // if the connection is reset be the other peer, try to close
                // it if it hasn't.
                this.socket.destroyed || this.socket.emit("close", true);
            }
        }).on("close", async () => {
            this.managerPid = void 0;

            try {
                // automatically re-connect when connection lost.
                this.closed || await this.tryConnect();
            } catch (err) {
                this.socket.emit("error", err);
            }
        });

        this.tryConnect();

        return this.socket;
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

    private isSocketResetError(err) {
        return err instanceof Error
            && (err["code"] == "ECONNRESET"
                || /socket.*(ended|closed)/.test(err.message));
    }

    private async tryServe(pid: number, addr: string | number): Promise<void> {
        try {
            let server = await this.bind(pid),
                _addr = server.address();

            addr = typeof _addr == "object" ? _addr.port : _addr;
            this.socket.connect(<any>addr);
        } catch (err) {
            if (err["code"] == "EADDRINUSE")
                this.socket.connect(<any>addr);
        }
    }

    private async tryConnect(managerPid?: number) {
        managerPid = managerPid || await getManagerPid();
        this.managerPid = managerPid;

        let addr = await this.getSocketAddr(managerPid);
        if (managerPid === process.pid)
            await this.tryServe(managerPid, addr);
        else
            this.socket.connect(<any>addr);
    }
}

/**
 * @param connectionListener A connection listener for `net.createServer()`.
 * @param timeout Default value is `5000`ms.
 */
export function openChannel(connectionListener: (socket: net.Socket) => void) {
    return new IPChannel(connectionListener);
}

export default openChannel;