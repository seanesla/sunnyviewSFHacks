import next from "eslint-config-next"

const config = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**", "out/**", "structurizr/out/**"],
  },
]

export default config
