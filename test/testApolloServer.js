import { apolloServer } from '../src/apolloServer';
import { makeExecutableSchema } from '../src/schemaGenerator';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest-as-promised';

const testSchema = `
      type RootQuery {
        usecontext: String
        useTestConnector: String
        species(name: String): String
        stuff: String
        errorField: String
      }
      schema {
        query: RootQuery
      }
    `;
const testResolvers = {
  __schema: () => {
    return { stuff: 'stuff', species: 'ROOT' };
  },
  RootQuery: {
    usecontext: (r, a, ctx) => {
      return ctx.usecontext;
    },
    useTestConnector: (r, a, ctx) => {
      return ctx.connectors.TestConnector.get();
    },
    species: (root, { name }) => root.species + name,
    errorField: () => {
      throw new Error('throws error');
    },
  },
};
class TestConnector {
  get() {
    return 'works';
  }
}
const testConnectors = {
  TestConnector,
};

const server = apolloServer({
  schema: testSchema,
  resolvers: testResolvers,
  connectors: testConnectors,
});

describe('ApolloServer', () => {
  it('can serve a basic request', () => {
    const app = express();
    app.use('/graphql', server);
    const expected = {
      stuff: 'stuff',
      useTestConnector: 'works',
      species: 'ROOTuhu',
    };
    return request(app).get(
      '/graphql?query={stuff useTestConnector species(name: "uhu")}'
    ).then((res) => {
      return expect(res.body.data).to.deep.equal(expected);
    });
  });
  it('can mock a schema', () => {
    const app = express();
    const mockServer = apolloServer({
      schema: testSchema,
      mocks: {
        RootQuery: () => ({
          stuff: () => 'stuffs',
          useTestConnector: () => 'utc',
          species: 'rawr',
        }),
      },
    });
    app.use('/graphql', mockServer);
    const expected = {
      stuff: 'stuffs',
      useTestConnector: 'utc',
      species: 'rawr',
    };
    return request(app).get(
      '/graphql?query={stuff useTestConnector species(name: "uhu")}'
    ).then((res) => {
      return expect(res.body.data).to.deep.equal(expected);
    });
  });
  it('can log errors', () => {
    const app = express();
    let lastError;
    const loggy = { log: (e) => { lastError = e.originalMessage; } };
    const logServer = apolloServer({
      schema: testSchema,
      resolvers: testResolvers,
      connectors: testConnectors,
      logger: loggy,
    });
    app.use('/graphql', logServer);
    return request(app).get(
      '/graphql?query={errorField}'
    ).then(() => {
      return expect(lastError).to.equal('throws error');
    });
  });

  it('can log errors with a graphQL-JS schema', () => {
    const app = express();
    let lastError;
    const loggy = { log: (e) => { lastError = e.originalMessage; } };
    const jsSchema = makeExecutableSchema({
      typeDefs: testSchema,
      resolvers: testResolvers,
      connectors: testConnectors,
    });
    const logServer = apolloServer({
      schema: jsSchema,
      logger: loggy,
    });
    app.use('/graphql', logServer);
    return request(app).get(
      '/graphql?query={errorField}'
    ).then(() => {
      return expect(lastError).to.equal('throws error');
    });
  });
  // TODO: test that allow undefined in resolve works

  // TODO: test wrong arguments error messages
  it('throws an error if you call it with more than one arg', () => {
    return expect(() => apolloServer(1, 2)).to.throw(
      'apolloServer expects exactly one argument, got 2'
    );
  });

  // express-graphql tests:

  describe('(express-grapqhl) Useful errors when incorrectly used', () => {
    it('requires an option factory function', () => {
      expect(() => {
        apolloServer();
      }).to.throw(
        'GraphQL middleware requires options.'
      );
    });

    it('requires option factory function to return object', async () => {
      var app = express();

      app.use('/graphql', apolloServer(() => null));

      var caughtError;
      var response;
      try {
        response = await request(app).get('/graphql?query={test}');
      } catch (error) {
        caughtError = error;
      }

      expect(response.status).to.equal(500);
      expect(JSON.parse(response.error.text)).to.deep.equal({
        errors: [
          { message:
            'GraphQL middleware option function must return an options object.' }
        ]
      });
    });

    it('requires option factory function to return object or promise of object', async () => {
      var app = express();

      app.use('/graphql', apolloServer(() => Promise.resolve(null)));

      var caughtError;
      var response;
      try {
        response = await request(app).get('/graphql?query={test}');
      } catch (error) {
        caughtError = error;
      }

      expect(response.status).to.equal(500);
      expect(JSON.parse(response.error.text)).to.deep.equal({
        errors: [
          { message:
            'GraphQL middleware option function must return an options object.' }
        ]
      });
    });

    it('requires option factory function to return object with schema', async () => {
      var app = express();

      app.use('/graphql', apolloServer(() => ({})));

      var caughtError;
      var response;
      try {
        response = await request(app).get('/graphql?query={test}');
      } catch (error) {
        caughtError = error;
      }

      expect(response.status).to.equal(500);
      expect(JSON.parse(response.error.text)).to.deep.equal({
        errors: [
          { message: 'GraphQL middleware options must contain a schema.' }
        ]
      });
    });

    it('requires option factory function to return object or promise of object with schema', async () => {
      var app = express();

      app.use('/graphql', apolloServer(() => Promise.resolve({})));

      var caughtError;
      var response;
      try {
        response = await request(app).get('/graphql?query={test}');
      } catch (error) {
        caughtError = error;
      }

      expect(response.status).to.equal(500);
      expect(JSON.parse(response.error.text)).to.deep.equal({
        errors: [
          { message: 'GraphQL middleware options must contain a schema.' }
        ]
      });
    });
  });
});
