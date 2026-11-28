// One import from every public subpath an app can reach through the compat
// plugin. Each name is that module's own export, so a subpath resolved to the
// wrong file fails the build or comes back undefined.
import { signal } from 'what-framework';
import { Spinner } from 'what-framework/ui';
import { useForm } from 'what-framework/form';
import { announce } from 'what-framework/a11y';
import { Router } from 'what-framework/router';
import { hydrateIslands } from 'what-framework/server';
import { insert } from 'what-framework/render';
import { createWhatError } from 'what-core/internal';
import { mapArray } from 'what-core/render';

const kits = { signal, Spinner, useForm, announce, Router, hydrateIslands, insert, createWhatError, mapArray };
window.__kits = Object.fromEntries(Object.entries(kits).map(([name, value]) => [name, typeof value]));
