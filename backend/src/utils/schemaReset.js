const resetters = []

function registerSchemaReset(reset) {
  resetters.push(reset)
}

function resetSchemaCaches() {
  for (const reset of resetters) reset()
}

module.exports = {
  registerSchemaReset,
  resetSchemaCaches,
}
