const mongoose = require('mongoose')
const uniqueValidator = require('mongoose-unique-validator')

mongoose.set('useFindAndModify', false)
mongoose.set('useCreateIndex', true)

const userSchema = mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    minlength: 3
  },
  // hardcoded password '1234'
  // no encryption, no hash, just plan text
  password: {
    type: String,
    required: true,
    minlength: 3
  },
  favoriteGenre: {
    type: String
  }
})

userSchema.plugin(uniqueValidator)

module.exports = mongoose.model('User', userSchema)