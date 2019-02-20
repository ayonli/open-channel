"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const net = require("net");
const os = require("os");
const path = require("path");
const cluster = require("cluster");
const fs = require("fs-extra");
const manager_process_1 = require("manager-process");
const isSocketResetError = require("is-socket-reset-error");
exports.isWin32 = process.platform == "win32";
exports.usingPort = exports.isWin32 && cluster.isWorker;
class ProcessChannel {
    constructor(name, connectionListener) {
        this.name = name;
        this.connectionListener = connectionListener;
        this.state = "initiated";
        this.managerPid = void 0;
        this.retries = 0;
        this.queue = [];
    }
    get connected() {
        return this.state == "connected";
    }
    connect(timeout = 5000) {
        this.socket = new net.Socket();
        this.state = "connecting";
        var maxRetries = Math.ceil(timeout / 50);
        var write = this.socket.write;
        var destroy = this.socket.destroy;
        var emit = this.socket.emit;
        this.socket.write = (...args) => {
            return this.connected
                ? write.apply(this.socket, args)
                : !!this.queue.push(args);
        };
        this.socket.destroy = (err) => {
            if (!err) {
                this.state = "closed";
                this.managerPid = void 0;
            }
            destroy.call(this.socket, err);
        };
        this.socket.emit = (event, ...args) => {
            if (event == "error") {
                let err = args[0];
                if (err["code"] == "ECONNREFUSED" || err["code"] == "ENOENT") {
                    if (this.retries < maxRetries) {
                        return !!setTimeout(() => {
                            this.retries++;
                            this.tryConnect(this.managerPid);
                        }, 50);
                    }
                    else {
                        return emit.call(this.socket, event, err);
                    }
                }
                else if (isSocketResetError(err)) {
                    this.socket.destroyed || this.socket.emit("close", false);
                    return true;
                }
                else {
                    return emit.call(this.socket, event, err);
                }
            }
            else if (event == "close") {
                try {
                    if (this.state != "connecting" && this.state != "closed")
                        this.tryConnect();
                    return true;
                }
                catch (err) {
                    return emit.call(this.socket, "error", err);
                }
            }
            else {
                emit.call(this.socket, event, ...args);
            }
            return true;
        };
        this.socket.on("connect", () => {
            this.retries = 0;
            this.state = "connected";
            let args;
            while (args = this.queue.shift()) {
                this.socket.write.apply(this.socket, args);
            }
        });
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
                    let _path = exports.isWin32 ? path.slice("\\\\?\\pipe".length) : path;
                    if (yield fs.pathExists(_path)) {
                        try {
                            yield fs.unlink(_path);
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
            let dir = os.tmpdir() + `/.${this.name}`, file = dir + "/" + pid;
            yield fs.ensureDir(dir);
            yield fs.writeFile(file, port, "utf8");
        });
    }
    getSocketAddr(pid) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let dir = os.tmpdir() + `/.${this.name}`, file = dir + "/" + pid;
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
function openChannel(name, listener = null) {
    if (typeof name == "function") {
        return new ProcessChannel("open-channel", name);
    }
    else {
        return new ProcessChannel(name, listener);
    }
}
exports.openChannel = openChannel;
exports.default = openChannel;
//# sourceMappingURL=index.js.map