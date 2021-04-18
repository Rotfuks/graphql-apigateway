import { ApolloServer } from 'apollo-server';
import fetch from 'node-fetch';
import { print } from 'graphql';
import {
  wrapSchema,
  introspectSchema,
  mergeSchemas,
  RenameTypes,
  RenameRootFields,
  delegateToSchema
} from 'graphql-tools';

const createExecutor = async (url) => {
  return async ({ document, variables }) => {
    const query = print(document);
    const fetchResult = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables })
    });
    return fetchResult.json();
  };
};

const createRemoteSchema = async (url, service) => {
  const executor = await createExecutor(url);
  return wrapSchema({
    schema: await introspectSchema(executor),
    executor,
    transforms: [
      new RenameTypes((name) => {
        if (name === "Customer") return `${service}Customer`;
        return name;
      }),
      new RenameRootFields((operationName, fieldName) => {
        if (fieldName === "customer") return `${service}Customer`;
        return fieldName;
      }),
    ],
  });
};

const createNewSchema = async () => {
  const catalogSchema = await createRemoteSchema('http://localhost:4000', 'Catalog');
  const orderSchema = await createRemoteSchema('http://localhost:8080/graphql', 'Order');

  const linkSchemaDefs = `
    extend type Query {
      customer (id: ID!): Customer
    }
    type Customer {
      order: OrderCustomer
      catalog: CatalogCustomer
    }
  `;

  const customResolver = {
    Query: {
      customer (parent, args, context, info) {
        return args.id;
      }
    },
    Customer: {
      catalog (parent, args, context, info){
        return delegateToSchema({
          schema: catalogSchema,
          operation: 'query',
          fieldName: 'CatalogCustomer',
          args: {id: parent},
          context,
          info,
        });
      },
      order (parent, args, context, info){
        return delegateToSchema({
          schema: orderSchema,
          operation: 'query',
          fieldName: 'OrderCustomer',
          args: {id: parent},
          context,
          info,
        });
      }
    }
  };

  return mergeSchemas({
    schemas: [ catalogSchema, orderSchema ],
    typeDefs: linkSchemaDefs,
    resolvers: customResolver
  });
};

const runServer = async () => {
  // Get newly merged schema
  const schema = await createNewSchema();
  // start server with the new schema
  const server = new ApolloServer({
    schema
  });
  server.listen({port: 4001}).then(({url}) => {
    console.log(`Running at ${url}`);
  });
};

try {
  runServer();
} catch (err) {
  console.error(err);
}