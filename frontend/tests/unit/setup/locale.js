// Unit tests run in English (the app's default is Hebrew); Hebrew has its own tests in
// tests/unit/i18n. Each test file starts in English again.
import { resetLocaleForTests } from '../../../src/i18n/index.js';

resetLocaleForTests('en');
