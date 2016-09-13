import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLEnumType,
  GraphQLUnionType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLType,
  GraphQLFieldDefinition,
  GraphQLResolveInfo,
  getNullableType,
  getNamedType,
  GraphQLNamedType,
  GraphQLFieldResolveFn,
} from 'graphql';
import { graphql } from 'graphql';
import * as uuid from 'node-uuid';
import { forEachField, buildSchemaFromTypeDefinitions } from './schemaGenerator';

import { IMocks, IMockServer, IMockOptions , IMockFn , IMockTypeFn , ITypeDefinitions } from './Interfaces';

// This function wraps addMockFunctionsToSchema for more convenience
function mockServer(schema: GraphQLSchema | ITypeDefinitions, mocks: IMocks, preserveResolvers: boolean = false): IMockServer {
  let mySchema: GraphQLSchema;
  if (!(schema instanceof GraphQLSchema)) {
    // TODO: provide useful error messages here if this fails
    mySchema = buildSchemaFromTypeDefinitions(schema);
  } else {
    mySchema = schema;
  }

  addMockFunctionsToSchema({ schema: mySchema, mocks, preserveResolvers });

  return { query: (query, vars) => graphql(mySchema, query, {}, {}, vars) };
}

// TODO allow providing a seed such that lengths of list could be deterministic
// this could be done by using casual to get a random list length if the casual
// object is global.
function addMockFunctionsToSchema({ schema, mocks = {}, preserveResolvers = false }: IMockOptions): void {
  function isObject(thing: any) {
    return thing === Object(thing) && !Array.isArray(thing);
  }

  if (!schema) {
    // XXX should we check that schema is an instance of GraphQLSchema?
    throw new Error('Must provide schema to mock');
  }
  if (!isObject(mocks)) {
    throw new Error('mocks must be of type Object');
  }

  // use Map internally, because that API is nicer.
  const mockFunctionMap: Map<string, IMockFn> = new Map();
  Object.keys(mocks).forEach((typeName) => {
    mockFunctionMap.set(typeName, mocks[typeName]);
  });

  mockFunctionMap.forEach((mockFunction, mockTypeName) => {
    if (typeof mockFunction !== 'function') {
      throw new Error(`mockFunctionMap[${mockTypeName}] must be a function`);
    }
  });

  const defaultMockMap: Map<string, IMockFn> = new Map();
  defaultMockMap.set('Int', () => Math.round(Math.random() * 200) - 100);
  defaultMockMap.set('Float', () => (Math.random() * 200) - 100);
  defaultMockMap.set('String', () => 'Hello World');
  defaultMockMap.set('Boolean', () => Math.random() > 0.5);
  defaultMockMap.set('ID', () => uuid.v4());

  function mergeObjects(a: Object, b: Object) {
    return Object.assign(a, b);
  }

  function copyOwnPropsIfNotPresent(target: Object, source: Object) {
    Object.getOwnPropertyNames(source).forEach(prop => {
      if (!Object.getOwnPropertyDescriptor(target, prop)) {
        Object.defineProperty(target, prop, Object.getOwnPropertyDescriptor(source, prop));
      }
    });
  }

  function copyOwnProps(target: Object, ...sources: Object[]) {
    sources.forEach(source => {
      let chain = source;
      while (chain) {
        copyOwnPropsIfNotPresent(target, chain);
        chain = Object.getPrototypeOf(chain);
      }
    });
    return target;
  }

  // returns a random element from that ary
  function getRandomElement(ary: any[]) {
    const sample = Math.floor(Math.random() * ary.length);
    return ary[sample];
  }

  // takes either an object or a (possibly nested) array
  // and completes the customMock object with any fields
  // defined on genericMock
  // only merges objects or arrays. Scalars are returned as is
  function mergeMocks(genericMockFunction: () => any, customMock: any): any {
    if (Array.isArray(customMock)) {
      return customMock.map((el: any) => mergeMocks(genericMockFunction, el));
    }
    if (isObject(customMock)) {
      return mergeObjects(genericMockFunction(), customMock);
    }
    return customMock;
  }

  function getResolveType(namedFieldType: GraphQLNamedType) {
    if ( (namedFieldType instanceof GraphQLInterfaceType) ||
         (namedFieldType instanceof GraphQLUnionType) ) {
        return namedFieldType.resolveType;
    } else {
        return undefined;
    }
  }

  function assignResolveType(type: GraphQLType) {
    const fieldType = getNullableType(type);
    const namedFieldType = getNamedType(fieldType);

    const oldResolveType = getResolveType(namedFieldType);
    if (preserveResolvers && oldResolveType && oldResolveType.length) {
      return;
    }

    if (namedFieldType instanceof GraphQLUnionType ||
        namedFieldType instanceof GraphQLInterfaceType) {
      // the default `resolveType` always returns null. We add a fallback
      // resolution that works with how unions and interface are mocked
      namedFieldType.resolveType = (data: any, context: any, info: GraphQLResolveInfo) => {
        return info.schema.getType(data.typename) as GraphQLObjectType;
      };
    }
  }

  const mockType = function mockType(type: GraphQLType, typeName?: string, fieldName?: string): GraphQLFieldResolveFn {
    // order of precendence for mocking:
    // 1. if the object passed in already has fieldName, just use that
    // --> if it's a function, that becomes your resolver
    // --> if it's a value, the mock resolver will return that
    // 2. if the nullableType is a list, recurse
    // 2. if there's a mock defined for this typeName, that will be used
    // 3. if there's no mock defined, use the default mocks for this type
    return (root: any, args: { [key: string]: any }, context: any, info: GraphQLResolveInfo): any => {
      // nullability doesn't matter for the purpose of mocking.
      const fieldType = getNullableType(type);
      const namedFieldType = getNamedType(fieldType);

      if (root && typeof root[fieldName] !== 'undefined') {
        let result: any;

        // if we're here, the field is already defined
        if (typeof root[fieldName] === 'function') {
          result = root[fieldName](root, args, context, info);
          if (result instanceof MockList) {
            result = result.mock(root, args, context, info, fieldType as GraphQLList, mockType);
          }
        } else {
          result = root[fieldName];
        }

        // Now we merge the result with the default mock for this type.
        // This allows overriding defaults while writing very little code.
        if (mockFunctionMap.has(namedFieldType.name)) {
          result = mergeMocks(
            mockFunctionMap.get(namedFieldType.name).bind(null, root, args, context, info), result
          );
        }
        return result;
      }

      if (fieldType instanceof GraphQLList) {
        return [mockType(fieldType.ofType)(root, args, context, info),
                mockType(fieldType.ofType)(root, args, context, info)];
      }
      if (mockFunctionMap.has(fieldType.name)) {
        // the object passed doesn't have this field, so we apply the default mock
        return mockFunctionMap.get(fieldType.name)(root, args, context, info);
      }
      if (fieldType instanceof GraphQLObjectType) {
        // objects don't return actual data, we only need to mock scalars!
        return {};
      }

      // TODO mocking Interface and Union types will require determining the
      // resolve type before passing it on.
      // XXX we recommend a generic way for resolve type here, which is defining
      // typename on the object.
      if (fieldType instanceof GraphQLUnionType) {
        const randomType = getRandomElement(fieldType.getTypes());
        return Object.assign({ typename: randomType }, mockType(randomType)(root, args, context, info));
      }
      if (fieldType instanceof GraphQLInterfaceType) {
        const possibleTypes = schema.getPossibleTypes(fieldType);
        const randomType = getRandomElement(possibleTypes);
        return Object.assign({ typename: randomType }, mockType(randomType)(root, args, context, info));
      }
      if (fieldType instanceof GraphQLEnumType) {
        return getRandomElement(fieldType.getValues()).value;
      }

      if (defaultMockMap.has(fieldType.name)) {
        return defaultMockMap.get(fieldType.name)(root, args, context, info);
      }
      // if we get to here, we don't have a value, and we don't have a mock for this type,
      // we could return undefined, but that would be hard to debug, so we throw instead.
      throw new Error(`No mock defined for type "${fieldType.name}"`);
    };
  };

  forEachField(schema, (field: GraphQLFieldDefinition, typeName: string, fieldName: string) => {
    assignResolveType(field.type);
    let mockResolver: GraphQLFieldResolveFn;

    // we have to handle the root mutation and root query types differently,
    // because no resolver is called at the root.
    const isOnQueryType: boolean = typeName === (<any> schema.getQueryType() || {}).name;
    const isOnMutationType: boolean = typeName === (<any> schema.getMutationType() || {}).name;

    if (isOnQueryType || isOnMutationType) {
      if (mockFunctionMap.has(typeName)) {
        const rootMock = mockFunctionMap.get(typeName);
        // XXX: BUG in here, need to provide proper signature for rootMock.
        if (rootMock(undefined, {}, {}, {} as any)[fieldName]) {
          // TODO: assert that it's a function
          mockResolver = (root: any,
                          args: { [key: string]: any },
                          context: any,
                          info: GraphQLResolveInfo) => {
            const updatedRoot = root || {}; // TODO: should we clone instead?
            updatedRoot[fieldName] = rootMock(root, args, context, info)[fieldName];
            // XXX this is a bit of a hack to still use mockType, which
            // lets you mock lists etc. as well
            // otherwise we could just set field.resolve to rootMock()[fieldName]
            // it's like pretending there was a resolve function that ran before
            // the root resolve function.
            return mockType(
              field.type, typeName, fieldName)(updatedRoot, args, context, info);
          };
        }
      }
    }
    if (!mockResolver) {
      mockResolver = mockType(field.type, typeName, fieldName);
    }
    if (!preserveResolvers || !field.resolve) {
      field.resolve = mockResolver;
    } else {
      const oldResolver = field.resolve;
      field.resolve = (rootObject?: any, args?: { [key: string]: any }, context?: any, info?: GraphQLResolveInfo) => Promise.all([
        mockResolver(rootObject, args, context, info),
        oldResolver(rootObject, args, context, info),
      ]).then(values => {
        const [mockedValue, resolvedValue] = values;
        if (isObject(mockedValue) && isObject(resolvedValue)) {
          // Object.assign() won't do here, as we need to all properties, including
          // the non-enumerable ones and defined using Object.defineProperty
          return copyOwnProps({}, resolvedValue, mockedValue);
        }
        return (undefined !== resolvedValue) ? resolvedValue : mockedValue;
      });
    }
  });
}

class MockList {
  private len: number | number[];
  private wrappedFunction: GraphQLFieldResolveFn;

  // wrappedFunction can return another MockList or a value
  constructor(len: number | number[], wrappedFunction?: GraphQLFieldResolveFn) {
    this.len = len;
    if (typeof wrappedFunction !== 'undefined') {
      if (typeof wrappedFunction !== 'function') {
        throw new Error('Second argument to MockList must be a function or undefined');
      }
      this.wrappedFunction = wrappedFunction;
    }
  }

  public mock(root: any,
              args: { [key: string]: any },
              context: any,
              info: GraphQLResolveInfo,
              fieldType: GraphQLList,
              mockTypeFunc: IMockTypeFn) {
    let arr: any[];
    if (Array.isArray(this.len)) {
      arr = new Array(this.randint(this.len[0], this.len[1]));
    } else {
      arr = new Array(this.len);
    }

    for (let i = 0; i < arr.length; i++) {
      if (typeof this.wrappedFunction === 'function') {
        const res = this.wrappedFunction(root, args, context, info);
        if (res instanceof MockList) {
          const nullableType = getNullableType(fieldType.ofType) as GraphQLList;
          arr[i] = res.mock(root, args, context, info, nullableType, mockTypeFunc);
        } else {
          arr[i] = res;
        }
      } else {
        arr[i] = mockTypeFunc(fieldType.ofType)(root, args, context, info);
      }
    }
    return arr;
  }

  private randint(low: number, high: number): number {
      return Math.floor((Math.random() * ((high - low) + 1)) + low);
  }
}

export {
  addMockFunctionsToSchema,
  MockList,
  mockServer,
};
