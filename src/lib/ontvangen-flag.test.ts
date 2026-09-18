// src/lib/ontvangen-flag.test.ts
// [ONTVANGEN-VLAG] The switch fails to the road that works today.
//
// Every one of these cases is a real way an environment variable arrives: unset on a fresh
// environment, pasted with a newline, typed as "1" out of habit, capitalised, or set to the word
// that means the opposite. Only one of them may enable a road that needs five schema boundaries
// live before it can finish a single document.

import { test } from "node:test"
import assert from "node:assert/strict"

import { receiveFirstEnabled, RECEIVE_FIRST_FLAG } from "./ontvangen-flag"

/** Silence the deliberate "you set it wrong" log; a red test should read as an assertion. */
function quietly<T>(fn: () => T): T {
  const original = console.error
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.error = original
  }
}

const withFlag = (value: string | undefined) =>
  value === undefined ? {} : { [RECEIVE_FIRST_FLAG]: value }

test("[ONTVANGEN-VLAG] exactly \"true\" turns it on, and nothing else does", () => {
  assert.equal(receiveFirstEnabled(withFlag("true") as NodeJS.ProcessEnv), true)
})

test("[ONTVANGEN-VLAG] absent is OFF — a fresh environment keeps the road that works", () => {
  assert.equal(receiveFirstEnabled({} as NodeJS.ProcessEnv), false)
  assert.equal(receiveFirstEnabled(withFlag("") as NodeJS.ProcessEnv), false)
})

test("[ONTVANGEN-VLAG] every near-miss is OFF, deliberately", () => {
  // A flag that guesses is a flag that can turn itself on. "1" is the usual convention elsewhere,
  // and someone will type it — against a database that cannot finish a single document.
  for (const value of ["1", "TRUE", "True", "yes", "on", "enabled", " true", "true ", "true\n"]) {
    assert.equal(
      quietly(() => receiveFirstEnabled(withFlag(value) as NodeJS.ProcessEnv)), false,
      `"${value.replace(/\n/g, "\\n")}" must not enable receive-first`,
    )
  }
})

test("[ONTVANGEN-VLAG] the words that mean OFF are OFF", () => {
  for (const value of ["false", "0", "off", "no"]) {
    assert.equal(quietly(() => receiveFirstEnabled(withFlag(value) as NodeJS.ProcessEnv)), false)
  }
})

test("[ONTVANGEN-VLAG] a value that is present but wrong is SAID, not swallowed", () => {
  // The alternative is an owner who set the flag, watched nothing change, and had no way to
  // find out why.
  const seen: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { seen.push(args[0]) }
  try {
    receiveFirstEnabled(withFlag("1") as NodeJS.ProcessEnv)
  } finally {
    console.error = original
  }
  assert.equal(seen.length, 1, "a misspelled flag must be visible in the logs")
  assert.match(String(seen[0]), /ONTVANGEN_RECEIVE_FIRST_ENABLED/)

  // …and the quiet cases stay quiet: absent is not a mistake.
  const quiet: unknown[] = []
  console.error = (...args: unknown[]) => { quiet.push(args[0]) }
  try {
    receiveFirstEnabled({} as NodeJS.ProcessEnv)
  } finally {
    console.error = original
  }
  assert.deepEqual(quiet, [], "an unset flag is the normal state, not a warning")
})

test("[ONTVANGEN-VLAG] it is a server flag — the name may never become public", () => {
  assert.ok(!RECEIVE_FIRST_FLAG.startsWith("NEXT_PUBLIC_"),
    "a client that could read this is a client that could be lied to about its own upload")
})
