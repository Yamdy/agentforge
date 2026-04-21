/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "agentforge",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws"
    }
  },
  async run() {
    const vpc = new sst.aws.Vpc("AgentForgeVpc")

    const database = new sst.aws.Postgres("AgentForgeDB", {
      vpc,
      version: "16",
      scaling: {
        min: 0.5,
        max: 2
      }
    })

    const redis = new sst.aws.Redis("AgentForgeRedis", {
      vpc
    })

    const api = new sst.aws.Function("AgentForgeApi", {
      vpc,
      runtime: "nodejs22.x",
      handler: "packages/server/dist/index.handler",
      url: true,
      environment: {
        NODE_ENV: "production",
        DATABASE_URL: database.url,
        REDIS_URL: redis.url,
        JWT_SECRET: new sst.Secret("JWTSecret").value,
        LLM_API_KEY: new sst.Secret("LLMApiKey").value
      },
      link: [database, redis]
    })

    new sst.aws.ApiGatewayV2("AgentForgeGateway", {
      routes: {
        "ANY /{proxy+}": api
      }
    })

    return {
      apiUrl: api.url,
      databaseUrl: database.url,
      redisUrl: redis.url
    }
  }
})
