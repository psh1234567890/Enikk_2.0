import { openSync, readFileSync, writeSync, closeSync, unlinkSync } from "node:fs";

export class DuplicateInstanceError extends Error {
    constructor() {
        super("Enikk 2.0이 이미 실행 중입니다. 중복 로그인하지 않습니다.");
        this.name = "DuplicateInstanceError";
    }
}

function isProcessAlive(pid: number): boolean {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM means the process may still exist, but access was denied.
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

function storedPid(path: string | URL): number | null {
    try {
        const content = readFileSync(path, "utf8").trim();
        const pid = Number(content);
        return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

/**
 * An atomic lock per project directory. No Discord token or student data
 * is stored. A stale lock is removed only when its process is no longer alive.
 */
export function acquireInstanceLock(path: string | URL): () => void {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const fd = openSync(path, "wx", 0o600);
            try {
                writeSync(fd, String(process.pid) + "\n");
            } finally {
                closeSync(fd);
            }

            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                process.off("exit", release);
                try {
                    if (storedPid(path) === process.pid) unlinkSync(path);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                        console.error("[Enikk] 실행 잠금 정리 실패");
                    }
                }
            };

            process.on("exit", release);
            return release;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "EEXIST") throw error;

            const pid = storedPid(path);
            if (pid === null) {
                // Another process may have created the file but not yet
                // written its PID. Fail closed rather than deleting its lock.
                throw new DuplicateInstanceError();
            }
            if (isProcessAlive(pid)) {
                throw new DuplicateInstanceError();
            }

            // The previous bot stopped unexpectedly; the recorded pid is dead.
            try {
                unlinkSync(path);
            } catch (removeError) {
                if ((removeError as NodeJS.ErrnoException).code !== "ENOENT") throw removeError;
            }
        }
    }
    throw new Error("Enikk 중복 실행 잠금을 확보하지 못했습니다.");
}