import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as cluster from "cluster";
import * as fs from "fs-extra";
import { getManagerPid } from "manager-process";
import isSocketResetError = require("is-socket-reset-error");

export const isWin32 = process.platform == "win32";
export const usingPort = isWin32 && cluster.isWorker;

export class ProcessChannel {
    /** The name of the channel. */
    // name: string;
    /**
     * Returns the status of the channel, which will either be *`initiated`, 
     * `connecting`, `connected` or `closed`.
     */
    state: "initiated" | "connecting" | "connected" | "closed" = "initiated";
    private managerPid: number = void 0;
    private retries: number = 0;
    private queue: any[][] = [];
    private socket: net.Socket;

    /**
     * @param name The name of the channel.
     * @param connectionListener Set for `net.createServer()`.
     */
    constructor(readonly name: string, private connectionListener: (socket: net.Socket) => void) { }

    /** Whether the channel is connected to the internal server. */
    get connected() {
        return this.state == "connected";
    }

    /**
     * Gets the socket client that will connect to the internal server.
     * @param timeout Default value is `5000`ms.
     */
    connect(timeout = 5000) {
        this.socket = new net.Socket();
        this.state = "connecting";

        var maxRetries = Math.ceil(timeout / 50);

        /* hack internal API */
        var write = this.socket.write;
        var destroy = this.socket.destroy;
        var emit = this.socket.emit;

        this.socket.write = (...args) => {
            // if the connection is ready, send message immediately, otherwise
            // push them into a queue.
            return this.connected
                ? write.apply(this.socket, args)
                : !!this.queue.push(args);
        };

        this.socket.destroy = (err?: Error) => {
            if (!err) {
                this.state = "closed";
                this.managerPid = void 0;
            }
            destroy.call(this.socket, err);
        };

        this.socket.emit = (event: string | symbol, ...args) => {
            if (event == "error") {
                let err: Error = args[0];

                if (err["code"] == "ECONNREFUSED" || err["code"] == "ENOENT") {
                    if (this.retries < maxRetries) {
                        return !!setTimeout(() => {
                            // retry connect
                            this.retries++;
                            this.tryConnect(this.managerPid);
                        }, 50);
                    } else {
                        return emit.call(this.socket, event, err);
                    }
                } else if (isSocketResetError(err)) {
                    // if the connection is reset be the other peer, try to 
                    // close it if it hasn't.
                    this.socket.destroyed || this.socket.emit("close", false);
                    return true;
                } else {
                    return emit.call(this.socket, event, err);
                }
            } else if (event == "close") {
                try {
                    // automatically re-connect when connection lost 
                    // unexpectively.
                    if (this.state != "connecting" && this.state != "closed")
                        this.tryConnect();

                    return true;
                } catch (err) {
                    return emit.call(this.socket, "error", err);
                }
            } else {
                emit.call(this.socket, event, ...args);
            }

            return true;
        }
        /* hack internal API */

        this.socket.on("connect", () => {
            this.retries = 0;
            this.state = "connected";

            // send out queued messages
            let args: any[];
            while (args = this.queue.shift()) {
                this.socket.write.apply(this.socket, args);
            }
        });

        this.tryConnect();

        return this.socket;
    }

    private async bind(pid: number) {
        let server = net.createServer(this.connectionListener);

        await new Promise(async (resolve, reject) => {
            server.once("error", err => {
                server.close();
                server.unref();

                // If the port is already in use, then throw the error, 
                // otherwise, just resolve void so that the program could retry.
                err["code"] == "EADDRINUSE" ? reject(err) : resolve();
            });

            if (usingPort) {
                // listen a random port number
                server.listen(() => resolve());
            } else {
                // bind to a Unix domain socket or Windows named pipe
                let path = <string>await this.getSocketAddr(pid);

                if (await fs.pathExists(path)) {
                    // When all the connection request run asynchronously, there
                    // is no guarantee that this procedure will run as expected 
                    // since anther process may delete the file before the 
                    // current process do. So must put the 'unlink' operation in
                    // a try block, and when fail, it will not cause the 
                    // process to terminate.
                    try { await fs.unlink(path); } finally { }
                }

                server.listen(path, () => resolve());
            }
        });

        if (usingPort) {
            await this.setPort(pid, server.address()["port"]);
        }

        return server;
    }

    private async setPort(pid: number, port: number) {
        let dir = os.tmpdir() + `/.${this.name}`,
            file = dir + "/" + pid;

        // Save the port to a temp file, so other processes can read the file to
        // get the port and connect.
        await fs.ensureDir(dir);
        await fs.writeFile(file, port, "utf8");
    }

    private async getSocketAddr(pid: number): Promise<string | number> {
        let dir = os.tmpdir() + `/.${this.name}`,
            file = dir + "/" + pid;

        if (!usingPort) {
            // Use domain socket on Unix and named pipe on Windows.
            await fs.ensureDir(dir);
            return !isWin32 ? file : path.join('\\\\?\\pipe', file);
        }

        try {
            // read the port from temp file.
            let data = await fs.readFile(file, "utf8");
            return parseInt(data) || 0;
        } catch (err) {
            return 0;
        }
    }

    private async tryServe(pid: number, addr: string | number): Promise<void> {
        try {
            let server = await this.bind(pid),
                _addr = server.address();

            addr = typeof _addr == "object" ? _addr.port : _addr;
            this.socket.connect(<any>addr);
        } catch (err) {
            // Since there might be several processes trying to start the server
            // at the same time, the current process might face an 
            // address-in-use error, if such an error is caught. try to 
            // connect it instead.
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
export function openChannel(connectionListener: (socket: net.Socket) => void): ProcessChannel;
export function openChannel(name: string, connectionListener: (socket: net.Socket) => void): ProcessChannel;
export function openChannel(name, listener = null) {
    if (typeof name == "function") {
        return new ProcessChannel("open-channel", name);
    } else {
        return new ProcessChannel(name, listener);
    }
}

export default openChannel;