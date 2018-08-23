const http = require("http");
const URL = require("url");
const FS = require("fs");
const VM = require("vm");
const QS = require("querystring");

const hostname = "127.0.0.1";
const port = "3000";
const wwwRoot = "C:/Projects/ocelot-cms/wwwroot/";

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
        if ("query" in this.context.url && key in this.context.url.query) {
            return {
                item: this.context.url.query[key]
            }
        }
        return undefined;
    }
}

function sendError(status, message, res) {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain");
    res.end(message);
}

function wrapText(text) {
    return 'Response.Write("' + text + '");';
}

function parseASP(context) {
    const str = context.data.toString();
    const chunks = [];
    let state = "text";
    let chunk = "";
    let index = 0;
    while (index < str.length) {
        let c = str.charAt(index);
        if (state === "text" && str.substr(index, 2) === "<%") {
            index += 1;
            if (chunk.length > 0) {
                chunks.push(wrapText(chunk));
                chunk = "";
            }
            state = "code";
     /*   } else if (state === "text" && str.substr(index, 4) === "<!--") {
            // comment
            index += 2;
            const start = index;

            while (index < str.length && str.substr(index, 3) !== "-->") {
                index += 1;
            }

            if (index === str.length) {
                // invalid comment
                context.res.end();
            }

            const comment = str.substr(start, index)
            const incIndex = comment.indexOf("#include") ;
            if (incIndex !== -1) {
            }
*/
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

    const sandbox = {
        Response: new ASPResponse(context),
        Request: new ASPRequest(context)
    }

    console.log("Parse complete: ", chunks.join("\n"));

    VM.runInNewContext(chunks.join("\n"), sandbox, {
        filename: context.url.pathname
    })

    context.res.end();
}

function handleASP(context) {
    console.log("Dynamic request for ", context.url.pathname);
    const targetFile = wwwRoot + context.url.pathname;

    if (FS.existsSync(targetFile)) {
        FS.readFile(targetFile, (err, data) => {
            if (err) {
                sendError(500, err, context.res);
                return;
            }
            context.data = data;
            try {
                parseASP(context);
            } catch (ex) {
                sendError(500, ex.stack, context.res);
            }
        })
    } else {
        sendError(404, "File not found", context.res);
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