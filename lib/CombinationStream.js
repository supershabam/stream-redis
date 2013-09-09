var stream = require('stream')
  , util   = require('util')

util.inherits(CombinationStream, stream.PassThrough)
module.exports = CombinationStream
function CombinationStream() {
  var self
  this.streams = Array.prototype.slice.apply(arguments)
  this.on('pipe', function(source) {
    source.unpipe(self)
    self.combination_stream = self.streams.reduce(function(memo, stream) {
      return source.pipe(stream)
    }, source)
  })
}
CombinationStream.prototype.pipe = function(dest, options) {
  return this.combination_stream.pipe(dest, options)
}
