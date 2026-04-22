// Generische Feathers-Typ-Template für panary-core Backend-Libraries.
//
// Jede App (api-edge/api-cloud) erweitert diese Typen in ihrer eigenen
// declarations.ts um app-spezifische ServiceTypes und Configuration —
// aber Hooks, Services und Utilities in den Libraries nutzen die
// generischen Typen, damit sie App-unabhängig bleiben.

import type { Application as FeathersApplication } from '@feathersjs/koa'
import type { HookContext as FeathersHookContext, NextFunction } from '@feathersjs/feathers'

export type { NextFunction }

// Generische Application — konkrete Apps erweitern ServiceTypes und Configuration
// über Module-Augmentation oder eigene declarations.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Application<S = any, C = any> = FeathersApplication<S, C>

// Generischer HookContext — Services können mit eigener Klasse typisiert werden.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HookContext<S = any> = FeathersHookContext<Application, S>
