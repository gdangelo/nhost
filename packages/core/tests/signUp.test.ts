import faker from '@faker-js/faker'
import { interpret } from 'xstate'
import { waitFor } from 'xstate/lib/waitFor.js'
import { INVALID_EMAIL_ERROR, INVALID_PASSWORD_ERROR } from '../src/errors'
import { createAuthMachine } from '../src/machines'
import { Typegen0 } from '../src/machines/index.typegen'
import { BASE_URL } from './helpers/config'
import {
  signUpConflictErrorHandler,
  signUpInternalErrorHandler,
  signUpNetworkErrorHandler,
  signUpWithSessionHandler
} from './helpers/handlers'
import server from './helpers/server'
import CustomClientStorage from './helpers/storage'
import { GeneralAuthState } from './helpers/types'

type AuthState = GeneralAuthState<Typegen0>

const customStorage = new CustomClientStorage(new Map())

const authMachine = createAuthMachine({
  backendUrl: BASE_URL,
  clientUrl: 'http://localhost:3000',
  clientStorage: customStorage,
  clientStorageType: 'custom',
  refreshIntervalTime: 1
})

const authService = interpret(authMachine)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

beforeEach(() => {
  authService.start()
})

afterEach(() => {
  authService.stop()
  customStorage.clear()
  server.resetHandlers()
})

test(`should fail if network is unavailable`, async () => {
  server.use(signUpNetworkErrorHandler)

  authService.send({
    type: 'SIGNUP_EMAIL_PASSWORD',
    email: faker.internet.email(),
    password: faker.internet.password(15)
  })

  const state: AuthState = await waitFor(authService, (state: AuthState) =>
    state.matches('authentication.signedOut.failed')
  )

  expect(state.context.errors).toMatchInlineSnapshot(`
    {
      "registration": {
        "error": "OK",
        "message": "Network Error",
        "status": 200,
      },
    }
  `)
})

test(`should fail if server returns an error`, async () => {
  server.use(signUpInternalErrorHandler)

  authService.send({
    type: 'SIGNUP_EMAIL_PASSWORD',
    email: faker.internet.email(),
    password: faker.internet.password(15)
  })

  const state: AuthState = await waitFor(authService, (state: AuthState) =>
    state.matches('authentication.signedOut.failed')
  )

  expect(state.context.errors).toMatchInlineSnapshot(`
    {
      "registration": {
        "error": "internal-error",
        "message": "Internal error",
        "status": 500,
      },
    }
  `)
})

test(`should fail if either email or password is incorrectly formatted`, async () => {
  // Scenario 1: Providing an invalid email address with a valid password
  authService.send({
    type: 'SIGNUP_EMAIL_PASSWORD',
    email: faker.internet.userName(),
    password: faker.internet.password(15)
  })

  const emailErrorSignInState: AuthState = await waitFor(authService, (state: AuthState) =>
    state.matches('authentication.signedOut.failed')
  )

  expect(emailErrorSignInState.context.errors).toMatchInlineSnapshot(`
      {
        "registration": {
          "error": "invalid-email",
          "message": "Email is incorrectly formatted",
          "status": 10,
        },
      }
    `)

  // Scenario 2: Providing a valid email address with an invalid password
  authService.send({
    type: 'SIGNUP_EMAIL_PASSWORD',
    email: faker.internet.email(),
    password: faker.internet.password(2)
  })

  const passwordErrorSignInState: AuthState = await waitFor(authService, (state: AuthState) =>
    state.matches('authentication.signedOut.failed')
  )

  expect(passwordErrorSignInState.context.errors).toMatchInlineSnapshot(`
      {
        "registration": {
          "error": "invalid-password",
          "message": "Password is incorrectly formatted",
          "status": 10,
        },
      }
    `)
})

test(`should fail if email has already been taken`, async () => {
  server.use(signUpConflictErrorHandler)

  authService.send({
    type: 'SIGNUP_EMAIL_PASSWORD',
    email: faker.internet.email(),
    password: faker.internet.password(15)
  })

  const state: AuthState = await waitFor(authService, (state: AuthState) =>
    state.matches('authentication.signedOut.failed')
  )

  expect(state.context.errors).toMatchInlineSnapshot(`
    {
      "registration": {
        "error": "email-already-in-use",
        "message": "Email already in use",
        "status": 409,
      },
    }
  `)
})

test(`should succeed if email and password are correctly formatted`, async () => {
  authService.send({
    type: 'SIGNUP_EMAIL_PASSWORD',
    email: faker.internet.email(),
    password: faker.internet.password(15)
  })

  const state: AuthState = await waitFor(authService, (state: AuthState) =>
    state.matches({ email: 'awaitingVerification', authentication: { signedOut: 'noErrors' } })
  )

  expect(state.context.user).toBeNull()
  expect(state.context.errors).toMatchInlineSnapshot('{}')
})

test(`should succeed if email and password are correctly formatted and user is already signed up`, async () => {
  server.use(signUpWithSessionHandler)

  authService.send({
    type: 'SIGNUP_EMAIL_PASSWORD',
    email: faker.internet.email(),
    password: faker.internet.password(15)
  })

  const state: AuthState = await waitFor(authService, (state: AuthState) =>
    state.matches({ authentication: { signedIn: { refreshTimer: { running: 'pending' } } } })
  )

  expect(state.context.user).not.toBeNull()
})
