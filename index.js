const { 
  ApolloServer,
  gql,
  UserInputError,
  AuthenticationError,
  PubSub } = require('apollo-server')
const { v4: uuidv4 } = require('uuid')
const mongoose = require('mongoose')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')
const config = require('./utils/config')
const book = require('./models/book')
const jwt = require('jsonwebtoken')
const { subscribe } = require('graphql')

console.log('Connecting to', config.MONGODB_URI)
const JWT_SECRET = config.JWT_SECRET
const pubsub = new PubSub()

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
    user: User
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

  type Subscription {
    bookAdded: Book!
    authorUpdated: Author!
  }
`

const resolvers = { //todo: revisit with the updated schema and data saved in database
  Query: {
    bookCount: () => {
      // console.log('bookCount')
      return Book.collection.countDocuments()
    },
    authorCount: () => {
      // console.log('authorCount')
      return Author.collection.countDocuments()
    },
    allBooks: async (root, args) => {
      // console.log('allBooks')
      const results = await Book.find({})
        .populate('author', { name: 1, born: 1 })
      // console.log('results', results)
      
      const { genre, author } = args

      return results
        .filter(a => genre ? a.genres.indexOf(genre) > -1 : a)
        .filter(b => author ? b.author.name === author : b)
    },
    allAuthors: () => {
      // console.log('allAuthors')
      return Author.find({})
    },
    me: (root, args, context) => {
      // console.log('context', context)
      // console.log('me')
      return context.currentUser
    }
  },
  Author: {
    bookCount: async (root) => {
      const books = await Book.find({})
        .populate('author', { name: 1 })
      // console.log('Author.bookCount')
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
          born: null,
          id: author.id
        }
      }
      // console.log('final', final)

      pubsub.publish('BOOK_ADDED', { bookAdded: final })

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

      pubsub.publish('AUTHOR_UPDATED', { authorUpdated: updatedAuthor })

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
        favoriteGenre: user.favoriteGenre,
        id: user._id
      }

      return {
        value: jwt.sign(userForToken, JWT_SECRET),
        user
      }
    }
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    },
    authorUpdated: {
      subscribe: () => pubsub.asyncIterator(['AUTHOR_UPDATED'])
    },
  },
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

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscriptions ready at ${subscriptionsUrl}`)
})