"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const net = require("net");
const os = require("os");
const path = require("path");
const cluster = require("cluster");
const fs = require("fs-extra");
const first_officer_1 = require("first-officer");
const merge = require("lodash/merge");
exports.isWin32 = process.platform == "win32";
exports.usingPort = exports.isWin32 && cluster.isWorker;
class IPChannel {
    constructor(connectionListener) {
        this.connectionListener = connectionListener;
        this.autoReconnect = true;
    }
    connect(timeout = 5000) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let socket = yield this.getConnection(timeout);
            socket.on("error", (err) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                if (this.autoReconnect && isSocketResetError(err)) {
                    merge(socket, yield this.getConnection(timeout));
                }
            }));
        });
    }
    bind(pid) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let server = net.createServer(this.connectionListener);
            yield new Promise((resolve, reject) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                server.once("error", (err) => {
                    server.close();
                    server.unref();
                    if (err["code"] == "EADDRINUSE") {
                        reject(err);
                    }
                    else {
                        resolve(null);
                    }
                });
                if (exports.usingPort) {
                    server.listen(() => {
                        resolve(null);
                    });
                }
                else {
                    let path = yield this.getSocketAddr(pid);
                    if (yield fs.pathExists(path)) {
                        try {
                            yield fs.unlink(path);
                        }
                        catch (e) { }
                    }
                    server.listen(path, () => {
                        resolve(null);
                    });
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
    tryConnect(addr) {
        return new Promise((resolve, reject) => {
            if (!addr)
                return resolve(null);
            let conn = net.createConnection(addr);
            conn.once("error", (err) => {
                if (err["code"] == "ECONNREFUSED" || err["code"] == "ENOENT") {
                    resolve(null);
                }
                else {
                    reject(err);
                }
            }).once("connect", () => {
                resolve(conn);
            });
        });
    }
    retryConnect(resolve, reject, timeout, pid) {
        let conn, retries = 0, maxRetries = Math.ceil(timeout / 50), timer = setInterval(() => tslib_1.__awaiter(this, void 0, void 0, function* () {
            retries++;
            conn = yield this.getConnection(timeout, pid);
            if (conn) {
                resolve(conn);
                clearInterval(timer);
            }
            else if (retries === maxRetries) {
                clearInterval(timer);
                let err = new Error("failed to get connection after "
                    + Math.round(timeout / 1000) + " seconds timeout");
                reject(err);
            }
        }), 50);
    }
    tryServe(pid, addr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            try {
                let server = yield this.bind(pid);
                if (server) {
                    let _addr = server.address();
                    addr = typeof _addr == "object" ? _addr.port : _addr;
                    return this.tryConnect(addr);
                }
            }
            catch (err) {
                if (err["code"] == "EADDRINUSE")
                    return this.tryConnect(addr);
                else
                    throw err;
            }
        });
    }
    getConnection(timeout = 5000, pid) {
        return new Promise((resolve, reject) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            pid = pid || (yield first_officer_1.getPid());
            let addr = yield this.getSocketAddr(pid), conn;
            conn = yield this.tryConnect(addr);
            if (!conn && pid === process.pid)
                conn = yield this.tryServe(pid, addr);
            conn ? resolve(conn) : this.retryConnect(resolve, reject, timeout, pid);
        }));
    }
}
exports.IPChannel = IPChannel;
function openChannel(connectionListener) {
    return new IPChannel(connectionListener);
}
exports.openChannel = openChannel;
function isSocketResetError(err) {
    return err instanceof Error
        && (err["code"] == "ECONNRESET"
            || /socket.*(ended|closed)/.test(err.message));
}
exports.isSocketResetError = isSocketResetError;
exports.default = openChannel;
//# sourceMappingURL=index.js.map