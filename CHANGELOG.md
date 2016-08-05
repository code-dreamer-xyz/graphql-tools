# Changelog

### vNEXT

* Unpin babel-core version to solve build problem (PR #92)


### v0.6.2

* Fix a bug with addSchemaLevelResolveFunction. It now runs once per tick (PR #91)


### v0.5.2

* Add addSchemaLevelResolveFunction to exports
* Remove dist folder before prepublish to make sure files deleted in source are not included in build

### v0.5.1

* Updated GraphQL dependency to 0.6.0
* Removed all tracer code, including `Tracer`, `addTracingToResolvers` and `decorateWithTracer`
