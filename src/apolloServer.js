import {
  makeExecutableSchema,
  buildSchemaFromTypeDefinitions,
  addErrorLoggingToSchema,
  addCatchUndefinedToSchema,
} from './schemaGenerator';
import { addMockFunctionsToSchema } from './mock';
import graphqlHTTP from 'express-graphql';
import { GraphQLSchema } from 'graphql';


export default function apolloServer(options) {
  // Resolve the Options to get OptionsData.
  return (req, res) => {
    new Promise(resolve => {
      resolve(typeof options === 'function' ? options(req) : options);
    }).then(optionsData => {
      // Assert that optionsData is in fact an Object.
      if (!optionsData || typeof optionsData !== 'object') {
        throw new Error(
          'GraphQL middleware option function must return an options object.'
        );
      }

      // Assert that schema is required.
      if (!optionsData.schema) {
        throw new Error(
          'GraphQL middleware options must contain a schema.'
        );
      }
      const {
        schema, // required
        resolvers, // required if mocks is not false and schema is not GraphQLSchema
        connectors, // required if mocks is not false and schema is not GraphQLSchema
        logger = { log: (x) => console.log(x) },
        mocks = false,
        allowUndefinedInResolve = false,
        formatError, // pass through
        pretty, // pass through
        graphiql = false, // pass through
        validationRules, // pass through
        context = {}, // pass through
        rootValue, // pass through
      } = optionsData;

      // TODO: throw an error if more than one arg is passed
      // TODO: throw an error if that argument is not an object
      if (!schema) {
        throw new Error('schema is required');
      }
      let executableSchema;
      if (mocks) {
        // TODO: mocks doesn't yet work with a normal GraphQL schema, but it should!
        // have to rewrite these functions
        const myMocks = mocks || {};
        executableSchema = buildSchemaFromTypeDefinitions(schema);
        addMockFunctionsToSchema({
          schema: executableSchema,
          mocks: myMocks,
        });
      } else {
        // this is just basics, makeExecutableSchema should catch the rest
        // TODO: should be able to provide a GraphQLschema and still use resolvers
        // and connectors if you want, but at the moment this is not possible.
        if (schema instanceof GraphQLSchema) {
          // addErrorLoggingToSchema(schema, logger);
          // addCatchUndefinedToSchema(schema);
          executableSchema = schema;
        } else {
          if (!resolvers) {
            throw new Error('resolvers is required option if mocks is not provided');
          }
          if (!connectors) {
            // TODO: don't require connectors, they're annoying
            throw new Error('connectors is a required option if mocks is not provided');
          }
          executableSchema = makeExecutableSchema({
            typeDefs: schema,
            resolvers,
            connectors,
            logger,
            allowUndefinedInResolve,
          });
        }
      }

      return graphqlHTTP({
        schema: executableSchema,
        context,
        formatError,
        rootValue,
        pretty,
        validationRules,
        graphiql,
      })(req, res);
    });
  };
}

export { apolloServer };
