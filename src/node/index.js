const http = require("http");
const URL = require("url");
const FS = require("fs");
const VM = require("vm");
const QS = require("querystring");
const PATH = require("path");

const hostname = "127.0.0.1";
const port = "3000";
//const wwwRoot = "C:/Projects/ocelot-cms/wwwroot/";
const wwwRoot = "C:/Projects/ocelot-node/wwwroot/";

const replace = {
    "\n": "\\n",
    "\r": "\\r",
    "\"": "\\\""
}

const mimeTypes = {
    "htm": "text/html;charset=utf8",
    "js": "application/javascript",
    "css": "text/css"
}

function buildASPActiveXObject(context) {
    return function (type) {
        if (type.startsWith("MSXML2")) {
            return {
                load(path) {
                    console.log("This is where I'd load something")
                }
            }
        } else if (type.startsWith("FSO")) {
            return {
                fileExists: function (path) {
                    return FS.existsSync(path);
                },
                folderExists: function (path) {
                    return FS.folderExists(path);
                }
            }
        }
    }
}

class ASPServer {
    constructor(context) {
        this.context = context;
    }

    MapPath(path) {
        return wwwRoot + path;
    }

    CreateObject(type) {
        var ActiveXObject = buildASPActiveXObject(this.context);
        return new ActiveXObject(type);
    }
}

class ASPResponse {
    constructor(context) {
        this.context = context;
    }

    Write(message) {
        this.context.res.write(message);
    }
}

class ASPRequest {
    constructor(context) {
        this.context = context;
    }

    QueryString(key) {
        const item = this.context.url.query[key]

        // This is a bit weird - the original code
        // works both as a value and as a function call.
        // Looks like setting toString fixes it.
        const result = function () {
            return item;
        }
        result.toString = result;
        return {
            item: result
        }
    }
}

function sendError(status, message, res) {
    if (!res.headersSent) {
        res.statusCode = status;
        res.setHeader("Content-Type", "text/plain");
    }
    res.end(message);
}

function wrapText(text) {
    return 'Response.Write("' + text + '");';
}

function escapeText(text) {
    let result = [];
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charAt(i);
        if (c in replace) {
            result.push(replace[c]);
        } else {
            result.push(c);
        }
    }
    return result.join('');
}

function readP(target) {
    console.log("Reading file ", target);
    return new Promise((resolve, reject) => {
        FS.readFile(wwwRoot + target, (err, data) => {
            if (err != null) {
                reject(err)
            } else {
                resolve(data);
            }
        })
    })
}

function getAttributes(str) {
    const attr = {};
    const match = str.match(/([^\t\n\f \/>"'=]+)="((?:[^"\\]|\\.)*)"/g)

    if (match !== null) {
        for (let i = 0; i < match.length; i += 1) {
            const [key, value] = match[i].split("=");
            attr[key] = value.substring(1, value.length - 1);
        }
    }
    return attr;
}

async function parseASP(myPath, str, startingState) {
    console.log("Parsing ", myPath);
    let chunks = [];
    let state = startingState || "text";
    let chunk = "";
    let index = 0;
    while (index < str.length) {
        let c = str.charAt(index);
        if (state === "text" && str.substr(index, 2) === "<%") {
            index += 1;
            if (chunk.length > 0) {
                chunks.push(wrapText(chunk));
            }
            chunk = "";
            state = "code";
        } else if (state === "text" && str.substr(index, 4) === "<!--") {
            if (chunk.length > 0) {
                chunks.push(wrapText(chunk));
            }
            chunk = "";
            index += 4;
            const start = index;

            while (index < str.length && str.substr(index, 3) !== "-->") {
                index += 1;
            }

            if (index === str.length) {
                // invalid comment
                throw new Error("Invalid comment");
            }

            const comment = str.substring(start, index)

            console.log("Comment: [" + comment + "]");
            const incIndex = comment.indexOf("#include");
            if (incIndex !== -1) {
                const attr = getAttributes(comment.substring(incIndex + "#include".length))
                console.log("Comment attr: ", attr);
                let path;
                if ("file" in attr) {
                    path = PATH.normalize(PATH.dirname(myPath) + "/" + attr["file"]);
                } else if ("virtual" in attr) {
                    path = attr["virtual"];
                }

                if (path !== undefined) {
                    const includeChunks = await readP(path).then(data => parseASP(path, data.toString()));
                    chunks = chunks.concat(includeChunks);
                }
            } else {
                chunks.push("<!--" + comment + "-->");
            }
            index += 2;
        } else if (state === "text" && str.startsWith("<script ", index)) {
            console.log("Handling script");
            if (chunk.length > 0) {
                chunks.push(wrapText(chunk));
            }
            chunk = "";

            const scriptStart = index + "<script ".length;
            const scriptTag = str.substring(scriptStart, str.indexOf(">", scriptStart))
            const scriptEnd = str.indexOf("</script>", index);
            const attr = getAttributes(scriptTag);

            if (attr["runat"] === "server") {
                if ("src" in attr) {
                    let path;
                    if (attr["src"].startsWith("/")) {
                        path = attr["src"]
                    } else {
                        path = PATH.normalize(PATH.dirname(myPath) + "/" + path);
                    }
                    console.log("Trying to read server side script file from ", path);
                    const includeChunks = await readP(path).then(data => parseASP(path, data.toString(), "code"));
                    chunks = chunks.concat(includeChunks);
                } else {
                    console.log("Including embedded server side script");
                    chunks.push(str.substring(scriptStart + scriptTag.length + 1, scriptEnd));
                }
            } else {
                chunks.push(
                    wrapText(
                        escapeText(
                            "<script " +
                            scriptTag +
                            str.substring(scriptStart + scriptTag.length, scriptEnd) +
                            "</script>"
                        )
                    )
                );
            }
            index = scriptEnd + "</script>".length;
        } else if (state === "code" && str.substr(index, 2) === "%>") {
            index += 1;
            if (chunk.length > 0) {
                if (chunk[0] !== "@") {
                    chunks.push(chunk);
                }
                chunk = "";
            }
            state = "text";
        } else if (state === "text" && c in replace) {
            chunk += replace[c];
        } else {
            chunk += c;
        }
        index += 1;
    }

    if (chunk.length > 0) {
        if (state === "text") {
            chunks.push(wrapText(chunk))
        } else {
            if (chunk[0] !== "@") {
                chunks.push(chunk);
            }
        }
    }

    return chunks;
}

function convertASP(context, chunks) {
    const sandbox = {
        Server: new ASPServer(context),
        Response: new ASPResponse(context),
        Request: new ASPRequest(context),
        ActiveXObject: buildASPActiveXObject(context)
    }

    //console.log("Parse complete: ", chunks.join("\n"));
    let debug = false;
    if (debug) {
        chunks.forEach(c => context.res.write(c));
    } else {
        VM.runInNewContext(chunks.join("\n"), sandbox, {
            filename: context.url.pathname
        })
    }

    context.res.end();
}

function handleASP(context) {
    console.log("Dynamic request for ", context.url.pathname);
    const targetFile = context.url.pathname;

    if (FS.existsSync(wwwRoot + targetFile)) {
        readP(targetFile).then(data => parseASP(targetFile, data.toString())
            .then(chunks => convertASP(context, chunks))
        ).catch(ex => sendError(500, ex.stack, context.res))
    } else {
        sendError(404, "File not found: " + context.url.pathname, context.res);
    }
}

function handleStatic(context) {
    console.log("Static request for ", context.url.pathname);

    function _sendFile(path) {
        context.res.statusCode = 200;

        const ext = path.substr(-3);
        if (ext in mimeTypes) {
            context.res.setHeader("Content-Type", mimeTypes[ext]);
        } else {
            context.res.setHeader("Content-Type", "application/octet-stream");
        }

        FS.createReadStream(path).pipe(context.res);
    }


    const targetFile = wwwRoot + context.url.pathname;

    if (FS.existsSync(targetFile)) {
        const stat = FS.statSync(targetFile);
        if (stat.isFile()) {
            _sendFile(targetFile);
        } else if (stat.isDirectory()) {
            if (targetFile.endsWith("/")) {
                if (FS.existsSync(targetFile + "index.htm")) {
                    _sendFile(targetFile + "index.htm")
                } else {
                    sendError(400, "Directory listing not allowed");
                }
            } else {
                context.res.writeHead(302, {
                    Location: context.url.pathname + "/" + context.url.search
                })
                context.res.end();
            }
        }
    } else {
        sendError(404, "Not found", context.res);
    }
}

const server = http.createServer((req, res) => {
    const context = {
        res: res,
        req: req,
        url: URL.parse(req.url, true)
    }

    if (context.url.pathname.endsWith(".asp")) {
        if (req.method === "POST" && req.headers["content-type"] === "application/x-www-form-urlencoded") {
            let body = [];
            req.on('data', chunk => body.push(chunk))
            req.on('end', () => {
                context.form = QS.parse(Buffer.concat(body).toString());
                handleASP(context);
            });
            req.on('error', err => sendError(400, err));
        } else {
            handleASP(context);
        }
        return;
    } else {
        handleStatic(context);
    }
});

server.listen(port, hostname, () => {
    console.log("Server running at http://${hostname}:${port}/");
});