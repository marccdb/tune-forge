import { BrowserWindow as e, app as t, dialog as n, ipcMain as r, session as i } from "electron";
import { promises as a } from "node:fs";
import o from "node:path";
import { fileURLToPath as s } from "node:url";
//#region electron/main.ts
var c = {
	pickFolder: "desktop:pick-folder",
	refreshFolder: "desktop:refresh-folder",
	readTrack: "desktop:read-track"
}, l = new Set([
	".aac",
	".aif",
	".aiff",
	".flac",
	".m4a",
	".m4b",
	".m4v",
	".mkv",
	".mov",
	".mp3",
	".mp4",
	".oga",
	".ogg",
	".opus",
	".wav",
	".weba",
	".webm",
	".wma"
]), u = {
	".aac": "audio/aac",
	".aif": "audio/aiff",
	".aiff": "audio/aiff",
	".flac": "audio/flac",
	".m4a": "audio/mp4",
	".m4b": "audio/mp4",
	".m4v": "video/mp4",
	".mkv": "video/x-matroska",
	".mov": "video/quicktime",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".oga": "audio/ogg",
	".ogg": "audio/ogg",
	".opus": "audio/ogg",
	".wav": "audio/wav",
	".weba": "audio/webm",
	".webm": "video/webm",
	".wma": "audio/x-ms-wma"
}, d = s(import.meta.url), f = o.dirname(d), p = /* @__PURE__ */ new Map(), m = /* @__PURE__ */ new Map(), h = 1;
function g(e) {
	return {
		ok: !0,
		data: e
	};
}
function _(e, t) {
	return {
		ok: !1,
		code: e,
		message: t
	};
}
function v(e) {
	return o.resolve(e);
}
function y(e, t) {
	return o.relative(e, t).split(o.sep).join("/");
}
function b(e, t) {
	let n = o.relative(e, t);
	return n === "" || !n.startsWith("..") && !o.isAbsolute(n);
}
function x(e) {
	return l.has(o.extname(e).toLowerCase());
}
function S(e) {
	let t = p.get(e);
	if (t) return t;
	let n = `folder_${h++}`;
	return p.set(e, n), n;
}
async function C(e) {
	let t = [], n = /* @__PURE__ */ new Map(), r = v(e), i = S(r);
	async function s(e) {
		let i = await a.readdir(e, { withFileTypes: !0 });
		for (let c of i) {
			let i = o.join(e, c.name);
			if (c.isSymbolicLink()) continue;
			if (c.isDirectory()) {
				await s(i);
				continue;
			}
			if (!c.isFile() || !x(i)) continue;
			let l = await a.stat(i), u = y(r, i), d = `${u}:${l.size}:${Math.trunc(l.mtimeMs)}`, f = {
				id: d,
				name: c.name,
				relativePath: u,
				fingerprint: d,
				size: l.size,
				lastModified: Math.trunc(l.mtimeMs)
			};
			t.push(f), n.set(u, {
				absolutePath: i,
				track: f
			});
		}
	}
	return await s(r), t.sort((e, t) => e.relativePath.localeCompare(t.relativePath, void 0, { sensitivity: "base" })), {
		folderId: i,
		rootPath: r,
		tracks: t,
		byRelativePath: n
	};
}
async function w() {
	let t = new e({
		width: 1400,
		height: 920,
		webPreferences: {
			preload: o.join(f, "preload.mjs"),
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !0
		}
	});
	t.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	let n = process.env.VITE_DEV_SERVER_URL;
	return n ? await t.loadURL(n) : await t.loadFile(o.join(f, "../dist/index.html")), t;
}
function T() {
	r.handle(c.pickFolder, async () => {
		let t = e.getFocusedWindow(), r = {
			title: "Select music folder",
			properties: ["openDirectory", "dontAddToRecent"]
		}, i = t ? await n.showOpenDialog(t, r) : await n.showOpenDialog(r);
		if (i.canceled || i.filePaths.length === 0) return _("PICKER_CANCELLED", "Folder selection cancelled.");
		let a = v(i.filePaths[0]);
		try {
			let e = await C(a);
			return m.set(e.folderId, e), g({
				folderId: e.folderId,
				folderName: o.basename(e.rootPath),
				tracks: e.tracks
			});
		} catch (e) {
			return _("SCAN_FAILED", e instanceof Error ? e.message : "Failed to scan folder.");
		}
	}), r.handle(c.refreshFolder, async (e, t) => {
		let n = t?.folderId ?? "", r = m.get(n);
		if (!n || !r) return _("FOLDER_FORBIDDEN", "Folder id is not in allowlist.");
		try {
			let e = {
				...await C(r.rootPath),
				folderId: r.folderId
			};
			return m.set(n, e), g({ tracks: e.tracks });
		} catch (e) {
			return _("SCAN_FAILED", e instanceof Error ? e.message : "Failed to refresh folder.");
		}
	}), r.handle(c.readTrack, async (e, t) => {
		let n = t?.folderId ?? "", r = t?.relativePath ?? "", i = m.get(n);
		if (!i) return _("TRACK_FORBIDDEN", "Folder id is not in allowlist.");
		let s = i.byRelativePath.get(r);
		if (!s || !b(i.rootPath, s.absolutePath)) return _("TRACK_FORBIDDEN", "Track path is not in allowlist.");
		try {
			let [e, t] = await Promise.all([a.stat(s.absolutePath), a.readFile(s.absolutePath)]);
			if (!e.isFile()) return _("TRACK_NOT_FILE", "Track path is not a file.");
			let n = o.extname(s.absolutePath).toLowerCase();
			return g({
				name: o.basename(s.absolutePath),
				mimeType: u[n] ?? "application/octet-stream",
				arrayBuffer: t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength)
			});
		} catch (e) {
			return _("READ_FAILED", e instanceof Error ? e.message : "Failed to read track.");
		}
	});
}
t.whenReady().then(async () => {
	i.defaultSession.setPermissionRequestHandler((e, t, n) => n(!1)), T(), await w(), t.on("activate", async () => {
		e.getAllWindows().length === 0 && await w();
	});
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit();
});
//#endregion
