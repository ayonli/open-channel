"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const net = require("net");
const os = require("os");
const path = require("path");
const cluster = require("cluster");
const fs = require("fs-extra");
const manager_process_1 = require("manager-process");
exports.isWin32 = process.platform == "win32";
exports.usingPort = exports.isWin32 && cluster.isWorker;
class ProcessChannel {
    constructor(connectionListener) {
        this.connectionListener = connectionListener;
        this.closed = false;
        this.managerPid = void 0;
        this.retries = 0;
        this.queue = [];
    }
    get connected() {
        return this.socket
            ? !this.socket.destroyed && !this.socket.connecting && !this.closed
            : false;
    }
    get state() {
        return this.connected ? "connected" : this.closed ? "closed" : "connecting";
    }
    connect(timeout = 5000) {
        this.socket = new net.Socket();
        var write = this.socket.write;
        var destroy = this.socket.destroy;
        var maxRetries = Math.ceil(timeout / 50);
        this.socket.write = (...args) => {
            return this.state !== "connecting"
                ? write.apply(this.socket, args)
                : !!this.queue.push(args);
        };
        this.socket.destroy = (...args) => {
            this.closed = true;
            this.managerPid = void 0;
            destroy.apply(this.socket, args);
        };
        this.socket.on("connect", () => {
            this.retries = 0;
            let args;
            while (args = this.queue.shift()) {
                this.socket.write.apply(this.socket, args);
            }
        }).on("error", (err) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (err["code"] == "ECONNREFUSED" || err["code"] == "ENOENT") {
                if (this.retries < maxRetries) {
                    this.retries++;
                    yield this.tryConnect(this.managerPid);
                }
            }
            else if (this.isSocketResetError(err)) {
                this.socket.destroyed || this.socket.emit("close", true);
            }
        })).on("close", () => tslib_1.__awaiter(this, void 0, void 0, function* () {
            try {
                this.closed || (yield this.tryConnect());
            }
            catch (err) {
                this.socket.emit("error", err);
            }
        }));
        this.tryConnect();
        return this.socket;
    }
    bind(pid) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let server = net.createServer(this.connectionListener);
            yield new Promise((resolve, reject) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                server.once("error", err => {
                    server.close();
                    server.unref();
                    err["code"] == "EADDRINUSE" ? reject(err) : resolve();
                });
                if (exports.usingPort) {
                    server.listen(() => resolve());
                }
                else {
                    let path = yield this.getSocketAddr(pid);
                    if (yield fs.pathExists(path)) {
                        try {
                            yield fs.unlink(path);
                        }
                        finally { }
                    }
                    server.listen(path, () => resolve());
                }
            }));
            if (exports.usingPort) {
                yield this.setPort(pid, server.address()["port"]);
            }
            return server;
        });
    }
    setPort(pid, port) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let dir = os.tmpdir() + "/.uipc", file = dir + "/" + pid;
            yield fs.ensureDir(dir);
            yield fs.writeFile(file, port, "utf8");
        });
    }
    getSocketAddr(pid) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let dir = os.tmpdir() + "/.uipc", file = dir + "/" + pid;
            if (!exports.usingPort) {
                yield fs.ensureDir(dir);
                return !exports.isWin32 ? file : path.join('\\\\?\\pipe', file);
            }
            try {
                let data = yield fs.readFile(file, "utf8");
                return parseInt(data) || 0;
            }
            catch (err) {
                return 0;
            }
        });
    }
    isSocketResetError(err) {
        return err instanceof Error
            && (err["code"] == "ECONNRESET"
                || /socket.*(ended|closed)/.test(err.message));
    }
    tryServe(pid, addr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            try {
                let server = yield this.bind(pid), _addr = server.address();
                addr = typeof _addr == "object" ? _addr.port : _addr;
                this.socket.connect(addr);
            }
            catch (err) {
                if (err["code"] == "EADDRINUSE")
                    this.socket.connect(addr);
            }
        });
    }
    tryConnect(managerPid) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            managerPid = managerPid || (yield manager_process_1.getManagerPid());
            this.managerPid = managerPid;
            let addr = yield this.getSocketAddr(managerPid);
            if (managerPid === process.pid)
                yield this.tryServe(managerPid, addr);
            else
                this.socket.connect(addr);
        });
    }
}
exports.ProcessChannel = ProcessChannel;
function openChannel(connectionListener) {
    return new ProcessChannel(connectionListener);
}
exports.openChannel = openChannel;
exports.default = openChannel;
//# sourceMappingURL=index.js.map