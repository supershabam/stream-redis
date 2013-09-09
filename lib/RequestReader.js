var stream = require('stream')
  , util   = require('util')

util.inherits(RequestReader, stream.Duplex)
function RequestReader() {
  stream.Duplex.call(this, {objectMode: true})
  this._token_stream   = new TokenStream()
  this._request_stream = new RequestStream()
  this._token_stream.pipe(this._request_stream)
  this.on('pipe', function(source) {
    source.unpipe(self)
  })
}

RequestReader.prototype._read = function(size) {
  this._request_stream._read(size)
}

RequestReader.prototype._write = function(chunk, encoding, done) {
  this._token_stream._write(chunk, encoding, done)
}