const booksRouter = require('express').Router()
const Book = require('../models/book')

booksRouter.get('/', async (request, response) => {
  const books = await Book.find({})
    // .populate('author', { name: 1, born: 1 })
  response.json(books)
})

booksRouter.post('/', async (request, response) => {
  const { title, published, author, genres } = request.body

  const book = new Book({
    title,
    published,
    author,
    genres
  })

  const savedBook = await book.save()
  
  // todo: create new author if this author is not exist
  // update author book count?
  
  response.json(savedBook)
})

module.export = booksRouter