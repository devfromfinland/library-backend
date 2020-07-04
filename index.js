const { ApolloServer, gql, UserInputError, AuthenticationError } = require('apollo-server')
const { v4: uuidv4 } = require('uuid')
const mongoose = require('mongoose')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')
const config = require('./utils/config')
const book = require('./models/book')
const jwt = require('jsonwebtoken')

console.log('Connecting to', config.MONGODB_URI)
const JWT_SECRET = config.JWT_SECRET

mongoose.connect(config.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch(error => {
    console.log('error connection to MongoDB', error.message)
  })

/*
 * Saattaisi olla järkevämpää assosioida kirja ja sen tekijä tallettamalla kirjan yhteyteen tekijän nimen sijaan tekijän id
 * Yksinkertaisuuden vuoksi tallennamme kuitenkin kirjan yhteyteen tekijän nimen
*/

const typeDefs = gql`
  type Author {
    name: String!
    born: Int
    id: ID!
    bookCount: Int
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    id: ID!
    genres: [String]!
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }
  
  type Token {
    value: String!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(genre: String, author: String): [Book!]!
    allAuthors: [Author!]!
    me: User
  }

  type Mutation {
    addBook(
      title: String!,
      author: String!,
      published: Int!,
      genres: [String]!
    ): Book

    editAuthor(
      name: String!
      setBornTo: Int
    ): Author

    addUser(
      username: String!
      favoriteGenre: String!
    ): User

    login(
      username: String!
      password: String!
    ): Token
  }
`

const resolvers = { //todo: revisit with the updated schema and data saved in database
  Query: {
    bookCount: () => Book.collection.countDocuments(),
    authorCount: () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      const results = await Book.find({})
        .populate('author', { name: 1, born: 1 })

      // console.log('results', results)
      return results
        .filter(a => args.genre ? a.genres.indexOf(args.genre) > -1 : a)
        .filter(b => args.author ? b.author.name === args.author : b)
    },
    allAuthors: () => {
      return Author.find({})
    },
    me: (root, args, context) => {
      // console.log('i am here')
      // console.log('context', context)
      return context.currentUser
    }
  },
  Author: {
    bookCount: async (root) => {
      const books = await Book.find({})
        .populate('author', { name: 1 })
      return books.filter(a => a.author.name === root.name).length
    }
  },
  Mutation: {
    addBook: async (root, args, context) => {
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError('not authenticated')
      }

      let author = await Author.findOne({ name: args.author })

      if (!author) {
        const newAuthor = new Author({ name: args.author, born: null })

        try {
          author = await newAuthor.save()
        } catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }
      }

      const book = new Book({
        title: args.title,
        published: args.published,
        genres: args.genres,
        author: author.id
      })

      let savedBook
      try {
        savedBook = await book.save()
      } catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }
      // console.log('savedBook', savedBook)

      const final = {
        id: savedBook.id,
        published: savedBook.published,
        title: savedBook.title,
        genres: savedBook.genres,
        author: {
          __typename: 'Author',
          name: author.name,
          born: null
        }
      }
      // console.log('final', final)

      return final
    },
    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError('not authenticated')
      }

      const { name, setBornTo } = args
      const year = parseInt(setBornTo)
      let author = await Author.findOne({ name })
      
      if (!author) {
        return null
      }

      // console.log('args', args)
      author.born = year
      // console.log('author', author)

      const updatedAuthor = await author.save()
      // console.log('updatedAuthor', updatedAuthor)

      return updatedAuthor
    },
    addUser: (root, args) => {
      const { username, favoriteGenre } = args
      const user = new User({
        username,
        password: '1234',
        favoriteGenre
      })

      return user.save()
        .catch (error => {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        })
    },
    login: async (root, args) => {
      // console.log('args', args)
      const { username, password } = args
      const user = await User.findOne({ username })

      if (!user || password !== '1234') {
        throw new UserInputError('wrong credentials')
      }

      const userForToken = {
        username: user.username,
        id: user._id
      }

      return { value: jwt.sign(userForToken, JWT_SECRET) }
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    // console.log('request headers', req.headers.authorization)
    const auth = req ? req.headers.authorization : null

    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const decodedToken = jwt.verify(
        auth.substring(7),
        JWT_SECRET
      )
      // console.log('decodedToken', decodedToken)

      const currentUser = await User.findById(decodedToken.id)

      return { currentUser }
    }
  },
})

server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`)
})