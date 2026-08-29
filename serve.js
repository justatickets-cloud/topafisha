const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, 'dist');
const TYPES = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon'};
http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html';
  let fp = path.join(ROOT, p);
  if(!fp.startsWith(ROOT)){res.writeHead(403);return res.end('403');}
  if(fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp=path.join(fp,'index.html');
  fs.readFile(fp,(err,buf)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});return res.end('404: '+p);}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream'});
    res.end(buf);
  });
}).listen(4322,()=>console.log('IDIR dev server on http://localhost:4322'));
