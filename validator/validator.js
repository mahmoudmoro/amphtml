/**
 * @license
 * Copyright 2015 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the license.
 */
goog.provide('amp.validator.CssLengthAndUnit');  // Only for testing.
goog.provide('amp.validator.Terminal');
goog.provide('amp.validator.annotateWithErrorCategories');
goog.provide('amp.validator.renderErrorMessage');
goog.provide('amp.validator.renderValidationResult');
goog.provide('amp.validator.validateString');
goog.require('amp.htmlparser.HtmlParser');
goog.require('amp.htmlparser.HtmlSaxHandlerWithLocation');
goog.require('amp.validator.AtRuleSpec');
goog.require('amp.validator.AtRuleSpec.BlockType');
goog.require('amp.validator.AttrList');
goog.require('amp.validator.CssSpec');
goog.require('amp.validator.RULES');
goog.require('amp.validator.TagSpec');
goog.require('amp.validator.ValidationError');
goog.require('amp.validator.ValidationError.Code');
goog.require('amp.validator.ValidationError.Severity');
goog.require('amp.validator.ValidationResult');
goog.require('amp.validator.ValidationResult.Status');
goog.require('amp.validator.ValidatorRules');
goog.require('goog.Uri');
goog.require('goog.array');
goog.require('goog.asserts');
goog.require('goog.string');
goog.require('goog.structs.Map');
goog.require('goog.structs.Set');
goog.require('goog.uri.utils');
goog.require('parse_css.BlockType');
goog.require('parse_css.RuleVisitor');
goog.require('parse_css.parseAStylesheet');
goog.require('parse_css.tokenize');

/**
 * Determines if |n| is an integer.
 * @param {number} n
 * @return {boolean}
 */
function isInteger(n) {
  return (Number(n) === n) && (n % 1 === 0);
}

/**
 * Sorts and eliminates duplicates in |arrayValue|.
 * @param {!Array<T>} arrayValue
 * @return {!Array<T>}
 * @template T
 */
function sortAndUniquify(arrayValue) {
  const arrayCopy = arrayValue.slice(0);
  goog.array.sort(arrayCopy);
  const unique = [];
  for (const v of arrayCopy) {
    if (unique.length === 0 || unique[unique.length - 1] !== v) {
      unique.push(v);
    }
  }
  return unique;
}

/**
 * Computes the difference set |left| - |right|, assuming |left| and
 * |right| are sorted and uniquified.
 * @param {!Array<T>} left
 * @param {!Array<T>} right
 * @return {!Array<T>} Computed difference of left - right.
 * @template T
 */
function subtractDiff(left, right) {
  let l = 0;
  let r = 0;
  const diff = [];
  while (l < left.length) {
    if (r >= right.length) {
      diff.push(left[l]);
      l++;
    } else if (right[r] > left[l]) {
      diff.push(left[l]);
      l++;
    } else if (right[r] < left[l]) {
      r++;
    } else {
      goog.asserts.assert(right[r] === left[l]);
      l++;
      r++;
    }
  }
  return diff;
}

/**
 * A higher number means |code| is more specific, meaning more
 * helpful. Used by maxSpecificity below.
 * @param {!amp.validator.ValidationError.Code} code
 * @return {number}
 */
function specificity(code) {
  switch (code) {
    case amp.validator.ValidationError.Code.UNKNOWN_CODE:
      return 0;
    case amp.validator.ValidationError.Code.
        MANDATORY_CDATA_MISSING_OR_INCORRECT:
      return 1;
    case amp.validator.ValidationError.Code.CDATA_VIOLATES_BLACKLIST:
      return 2;
    case amp.validator.ValidationError.Code.DISALLOWED_TAG_ANCESTOR:
      return 3;
    case amp.validator.ValidationError.Code.MANDATORY_TAG_ANCESTOR:
      return 4;
    case amp.validator.ValidationError.Code.MANDATORY_TAG_ANCESTOR_WITH_HINT:
      return 5;
    case amp.validator.ValidationError.Code.WRONG_PARENT_TAG:
      return 6;
    case amp.validator.ValidationError.Code.MANDATORY_TAG_MISSING:
      return 7;
    case amp.validator.ValidationError.Code.TAG_REQUIRED_BY_MISSING:
      return 8;
    case amp.validator.ValidationError.Code.DISALLOWED_TAG:
      return 9;
    case amp.validator.ValidationError.Code.DISALLOWED_ATTR:
      return 10;
    case amp.validator.ValidationError.Code.INVALID_ATTR_VALUE:
      return 11;
    case amp.validator.ValidationError.Code.ATTR_VALUE_REQUIRED_BY_LAYOUT:
      return 12;
    case amp.validator.ValidationError.Code.MANDATORY_ATTR_MISSING:
      return 13;
    case amp.validator.ValidationError.Code.MANDATORY_ONEOF_ATTR_MISSING:
      return 14;
    case amp.validator.ValidationError.Code.DUPLICATE_UNIQUE_TAG:
      return 15;
    case amp.validator.ValidationError.Code.STYLESHEET_TOO_LONG:
      return 16;
    case amp.validator.ValidationError.Code.CSS_SYNTAX:
      return 17;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_INVALID_AT_RULE:
      return 18;
    case amp.validator.ValidationError.Code.
        MANDATORY_PROPERTY_MISSING_FROM_ATTR_VALUE:
      return 19;
    case amp.validator.ValidationError.Code.
        INVALID_PROPERTY_VALUE_IN_ATTR_VALUE:
      return 20;
    case amp.validator.ValidationError.Code.DISALLOWED_PROPERTY_IN_ATTR_VALUE:
      return 21;
    case amp.validator.ValidationError.Code.MUTUALLY_EXCLUSIVE_ATTRS:
      return 22;
    case amp.validator.ValidationError.Code.UNESCAPED_TEMPLATE_IN_ATTR_VALUE:
      return 23;
    case amp.validator.ValidationError.Code.TEMPLATE_PARTIAL_IN_ATTR_VALUE:
      return 24;
    case amp.validator.ValidationError.Code.TEMPLATE_IN_ATTR_NAME:
      return 25;
    case amp.validator.ValidationError.Code.
        INCONSISTENT_UNITS_FOR_WIDTH_AND_HEIGHT:
      return 26;
    case amp.validator.ValidationError.Code.IMPLIED_LAYOUT_INVALID:
      return 27;
    case amp.validator.ValidationError.Code.SPECIFIED_LAYOUT_INVALID:
      return 28;
    case amp.validator.ValidationError.Code.DEV_MODE_ENABLED:
      return 29;
    case amp.validator.ValidationError.Code.ATTR_DISALLOWED_BY_IMPLIED_LAYOUT:
      return 30;
    case amp.validator.ValidationError.Code.ATTR_DISALLOWED_BY_SPECIFIED_LAYOUT:
      return 31;
    case amp.validator.ValidationError.Code.MISSING_URL:
      return 32;
    case amp.validator.ValidationError.Code.INVALID_URL_PROTOCOL:
      return 33;
    case amp.validator.ValidationError.Code.INVALID_URL:
      return 34;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_STRAY_TRAILING_BACKSLASH:
      return 35;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_UNTERMINATED_COMMENT:
      return 36;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_UNTERMINATED_STRING:
      return 37;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_BAD_URL:
      return 38;
    case amp.validator.ValidationError.Code
        .CSS_SYNTAX_EOF_IN_PRELUDE_OF_QUALIFIED_RULE:
      return 39;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_INVALID_DECLARATION:
      return 40;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_INCOMPLETE_DECLARATION:
      return 41;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_ERROR_IN_PSEUDO_SELECTOR:
      return 42;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_MISSING_SELECTOR:
      return 43;
    case amp.validator.ValidationError.Code.CSS_SYNTAX_NOT_A_SELECTOR_START:
      return 44;
    case amp.validator.ValidationError.Code.
        CSS_SYNTAX_UNPARSED_INPUT_REMAINS_IN_SELECTOR:
      return 45;

    case amp.validator.ValidationError.Code.DEPRECATED_ATTR:
      return 101;
    case amp.validator.ValidationError.Code.DEPRECATED_TAG:
      return 102;
    default:
      goog.asserts.fail('Unrecognized Code: ' + code);
  }
}

/**
 * A helper function which allows us to compare two candidate results
 * in validateTag to report the results which have the most specific errors.
 * @param {!amp.validator.ValidationResult} validationResult
 * @return {number} maximum value of specificity found in all errors.
 */
function maxSpecificity(validationResult) {
  let max = 0;
  for (const error of validationResult.errors) {
    goog.asserts.assert(error.code != null);
    const thisSpecificity = specificity(error.code);
    max = Math.max(thisSpecificity, max);
  }
  return max;
}

/**
 * Merge results from another ValidationResult while dealing with the UNKNOWN
 *   status.
 * @param {!amp.validator.ValidationResult} other
 */
amp.validator.ValidationResult.prototype.mergeFrom = function(other) {
  goog.asserts.assert(this.status !== null);
  goog.asserts.assert(other.status !== null);
  if (other.status !== amp.validator.ValidationResult.Status.UNKNOWN) {
    this.status = other.status;
  }
  Array.prototype.push.apply(this.errors, other.errors);
};

/**
 * The terminal is an abstraction for the window.console object which
 * accomodates differences between console implementations and provides
 * a convenient way to capture what's being emitted to the terminal
 * in a unittest. Pass the optional parameter to the constructor
 * to observe the calls that would have gone to window.console otherwise.
 * @constructor
 */
amp.validator.Terminal = class {
  /**
   * @param {!Array<string>=} opt_out an array into which the terminal will
   *     emit one string per info / warn / error calls.
   */
  constructor(opt_out) {
    this.out_ = opt_out || null;
  }

  /** @param {!string} msg */
  info(msg) {
    if (this.out_) {
      this.out_.push('I: ' + msg);
    } else {
      (console.info || console.log).call(console, msg);
    }
  }

  /** @param {!string} msg */
  warn(msg) {
    if (this.out_) {
      this.out_.push('W: ' + msg);
    } else if (console.warn) {
      console.warn(msg);
    } else {
      console.log('WARNING: ' + msg);
    }
  }

  /** @param {!string} msg */
  error(msg) {
    if (this.out_) {
      this.out_.push('E: ' + msg);
    } else if (console.error) {
      console.error(msg);
    } else {
      console.log('ERROR: ' + msg);
    }
  }
}

/**
 * Emits this validation result to the terminal, distinguishing warnings and
 *   errors.
 * @param {string} url
 * @param {!amp.validator.Terminal=} opt_terminal
 */
amp.validator.ValidationResult.prototype.outputToTerminal =
    function(url, opt_terminal) {

  const terminal = opt_terminal || new amp.validator.Terminal();
  const status = this.status;
  if (status === amp.validator.ValidationResult.Status.PASS) {
    terminal.info('AMP validation successful.');
  } else if (status === amp.validator.ValidationResult.Status.FAIL) {
    terminal.error('AMP validation had errors:');
  } else {
    terminal.error(
        'AMP validation had unknown results. This should not happen.');
  }
  for (const error of this.errors) {
    if (error.severity ===
        amp.validator.ValidationError.Severity.ERROR) {
      terminal.error(errorLine(url, error));
    } else {
      terminal.warn(errorLine(url, error));
    }
  }
};

/**
 * A line / column pair.
 * @private
 */
class LineCol {
  /**
   * @param {!number} line
   * @param {!number} col
   */
  constructor(line, col) {
    this.line_ = line;
    this.col_ = col;
  }

  /** @return {number} */
  getLine() { return this.line_; }

  /** @return {number} */
  getCol() { return this.col_; }
}

/**
 * Some tags have no end tags as per HTML5 spec. These were extracted
 * from the single page spec by looking for "no end tag" with CTRL+F.
 * @type {Object<string, number>}
 */
const TagsWithNoEndTags = function() {
  // TODO(johannes): Figure out how to prevent the Closure compiler from
  // renaming entries in a map. I wanted to do it the same way that
  // amp.htmlparser.HtmlParser.Elements is done (htmlparser.js), but it kept
  // renaming my keys causing lookup failures. :-(
  const tags = ['base', 'link', 'meta', 'hr', 'br', 'wbr', 'img', 'embed',
                'param', 'source', 'track', 'area', 'col', 'input', 'keygen'];
  const dict = {};
  for (const tag of tags) {
    dict[tag] = 0;
  }
  return dict;
}();

/**
 * This abstraction keeps track of the tag names as we enter / exit
 * tags in the document. Closing tags is tricky:
 * - For tags with no end tag per spec, we close them in EnterTag when
 *   another tag is encountered.
 * - In addition, we assume that all end tags are optional and we close,
 *   that is, pop off tags our stack, lazily as we encounter parent closing
 *   tags. This part differs slightly from the behavior per spec: instead of
 *   closing an <option> tag when a following <option> tag is seen, we close
 *   it when the parent closing tag (in practice <select>) is encountered.
 * @private
 */
class TagNameStack {
  /** Creates an empty instance. */
  constructor() {
    /**
     * The current tag name and its parents.
     * @type {!Array<string>}
     * @private
     */
    this.stack_ = [];
  }

  /**
   * We enter a tag, and if the previously entered tag doesn't come with an
   * end tag (per spec), we exit that.
   * @param {!string} tagName
   */
  enterTag(tagName) {
    if (this.stack_.length > 0 &&
        TagsWithNoEndTags.hasOwnProperty(this.stack_[this.stack_.length - 1])) {
      this.stack_.pop();
    }
    this.stack_.push(tagName);
  }

  /**
   * We exit a tag.
   * @param {!string} tagName
   */
  exitTag(tagName) {
    // We look for ragName from the end. If we can find it, we pop
    // everything from thereon off the stack.
    const idx = this.stack_.lastIndexOf(tagName);
    if (idx !== -1) {
      this.stack_ = this.stack_.slice(0, idx);
    }
  }

  /**
   * The name of the current tag.
   * @return {!string}
   */
  getCurrent() {
    goog.asserts.assert(this.stack_.length > 0, 'Empty tag stack.');
    return this.stack_[this.stack_.length - 1];
  };

  /**
   * The name of the parent of the current tag.
   * @return {!string}
   */
  getParent() {
    if (this.stack_.length >= 2)
    return this.stack_[this.stack_.length - 2];
    return '$ROOT';
  }

  /**
   * Returns true if the current tag has ancestor with the given tag name.
   * @param {!string} ancestor
   * @return {boolean}
   */
  hasAncestor(ancestor) {
    // Skip the last element, which is the current tag.
    for (let i = 0; i < this.stack_.length - 1; ++i) {
      if (this.stack_[i] === ancestor)
      return true;
    }
    return false;
  }
}

/**
 * Returns true if the given AT rule is considered valid.
 * @param {!amp.validator.CssSpec} cssSpec
 * @param {string} atRuleName
 * @return {boolean}
 */
function isAtRuleValid(cssSpec, atRuleName) {
  let defaultType = '';

  for (const atRuleSpec of cssSpec.atRuleSpec) {
    if (atRuleSpec.name === '$DEFAULT') {
      defaultType = atRuleSpec.type;
    } else if (atRuleSpec.name === atRuleName) {
      return atRuleSpec.type !==
          amp.validator.AtRuleSpec.BlockType.PARSE_AS_ERROR;
    }
  }

  goog.asserts.assert(defaultType !== '');
  return defaultType !== amp.validator.AtRuleSpec.BlockType.PARSE_AS_ERROR;
}

/** @private */
class InvalidAtRuleVisitor extends parse_css.RuleVisitor {
  /**
   * @param {!amp.validator.TagSpec} tagSpec
   * @param {!amp.validator.CssSpec} cssSpec
   * @param {!Context} context
   * @param {!amp.validator.ValidationResult} result
   */
  constructor(tagSpec, cssSpec, context, result) {
    super();
    /** @type {!amp.validator.TagSpec} */
    this.tagSpec = tagSpec;
    /** @type {!amp.validator.CssSpec} */
    this.cssSpec = cssSpec;
    /** @type {!Context} */
    this.context = context;
    /** @type {!amp.validator.ValidationResult} */
    this.result = result;
    /** @type {boolean} */
    this.errorsSeen = false;
  }

  /** @inheritDoc */
  visitAtRule(atRule) {
    if (!isAtRuleValid(this.cssSpec, atRule.name)) {
      this.context.addErrorWithLineCol(
          new LineCol(atRule.line, atRule.col),
          amp.validator.ValidationError.Code.CSS_SYNTAX_INVALID_AT_RULE,
          /* params */ [getDetailOrName(this.tagSpec), atRule.name],
          /* url */ '', this.result);
      this.errorsSeen = true;
    }
  }
}

/**
 * Generates an AT Rule Parsing Spec from a CssSpec.
 * @param {!amp.validator.CssSpec} cssSpec
 * @return {!Object<string, parse_css.BlockType>}
 */
function computeAtRuleParsingSpec(cssSpec) {
  /** @type {!Object<string, parse_css.BlockType>} */
  const ampAtRuleParsingSpec = {};
  for (const atRuleSpec of cssSpec.atRuleSpec) {
    goog.asserts.assert(atRuleSpec.name !== null);
    if (atRuleSpec.type === amp.validator.AtRuleSpec.BlockType.PARSE_AS_ERROR ||
        atRuleSpec.type ===
        amp.validator.AtRuleSpec.BlockType.PARSE_AS_IGNORE) {
      ampAtRuleParsingSpec[atRuleSpec.name] =
          parse_css.BlockType.PARSE_AS_IGNORE;
    } else if (atRuleSpec.type ===
        amp.validator.AtRuleSpec.BlockType.PARSE_AS_RULES) {
      ampAtRuleParsingSpec[atRuleSpec.name] =
          parse_css.BlockType.PARSE_AS_RULES;
    } else if (atRuleSpec.type ===
        amp.validator.AtRuleSpec.BlockType.PARSE_AS_DECLARATIONS) {
      ampAtRuleParsingSpec[atRuleSpec.name] =
          parse_css.BlockType.PARSE_AS_DECLARATIONS;
    } else {
      goog.asserts.fail('Unrecognized atRuleSpec type: ' + atRuleSpec.type);
    }
  }
  return ampAtRuleParsingSpec;
}

/**
 * Returns the default AT rule parsing spec.
 * @param {!Object<string,parse_css.BlockType>} atRuleParsingSpec
 * @return {parse_css.BlockType}
 */
function computeAtRuleDefaultParsingSpec(atRuleParsingSpec) {
  const ret = atRuleParsingSpec['$DEFAULT'];
  goog.asserts.assert(ret !== undefined, 'No default atRuleSpec found');
  return ret;
}

/**
 * This matcher maintains a constraint to check which an opening tag
 * introduces: a tag's cdata matches constraints set by it's cdata
 * spec. Unfortunately we need to defer such checking and can't
 * handle it while the opening tag is being processed.
 * @private
 */
class CdataMatcher {
  /**
   * @param {!amp.validator.TagSpec} tagSpec
   */
  constructor(tagSpec) {
    /** @private @type {!amp.validator.TagSpec} */
    this.tagSpec_ = tagSpec;

    // The CDataMatcher in Javascript also keeps track of the line/column
    // information from the context when it was created. This is necessary
    // because this code does not have control over the advancement of the
    // DocLocator instance (in Context) over the document, so by the time
    // we know that there's something wrong with the cdata for a tag,
    // we've advanced past the tag. This information gets filled in
    // by Context.setCdataMatcher.

    /** @private @type {!LineCol} */
    this.lineCol_ = new LineCol(1, 0);
  }

  /**
   * Matches the provided cdata against what this matcher expects.
   * @param {string} cdata
   * @param {!Context} context
   * @param {!amp.validator.ValidationResult} validationResult
   */
  match(cdata, context, validationResult) {
    const cdataSpec = this.tagSpec_.cdata;
    if (cdataSpec === null)
    return;
    if (context.getProgress(validationResult).complete)
    return;

    // Max CDATA Byte Length
    if (cdataSpec.maxBytes !== null) {
      const bytes = byteLength(cdata);
      if (bytes > cdataSpec.maxBytes) {
        context.addError(amp.validator.ValidationError.Code.STYLESHEET_TOO_LONG,
                         /* params */ [bytes, cdataSpec.maxBytes],
                         cdataSpec.maxBytesSpecUrl, validationResult);
        // We return early if the byte length is violated as parsing
        // really long stylesheets is slow and not worth our time.
        return;
      }
    }
    if (context.getProgress(validationResult).complete)
    return;

    // The mandatory_cdata, cdata_regex, and css_spec fields are treated
    // like a oneof, but we're not using oneof because it's a feature
    // that was added after protobuf 2.5.0 (which our open-source
    // version uses).
    // begin oneof {

    // Mandatory CDATA exact match
    if (cdataSpec.mandatoryCdata !== null) {
      if (cdataSpec.mandatoryCdata !== cdata) {
        context.addError(
            amp.validator.ValidationError.Code.
                MANDATORY_CDATA_MISSING_OR_INCORRECT,
            /* params */ [getDetailOrName(this.tagSpec_)],
            this.tagSpec_.specUrl, validationResult);
      }
      // We return early if the cdata has an exact match rule. The
      // spec shouldn't have an exact match rule that doesn't validate.
      return;
    } else if (cdataSpec.cdataRegex !== null) {
      const cdataRegex = new RegExp('^(' + cdataSpec.cdataRegex + ')$');
      if (!cdataRegex.test(cdata)) {
        context.addError(
            amp.validator.ValidationError.Code.
                MANDATORY_CDATA_MISSING_OR_INCORRECT,
            /* params */ [getDetailOrName(this.tagSpec_)],
            this.tagSpec_.specUrl, validationResult);
        return;
      }
    } else if (cdataSpec.cssSpec !== null) {
      /** @type {!Array<!parse_css.ErrorToken>} */
      const cssErrors = [];
      /** @type {!Array<!parse_css.Token>} */
      const tokenList = parse_css.tokenize(cdata,
                                           this.getLineCol().getLine(),
                                           this.getLineCol().getCol(),
                                           cssErrors);
      /** @type {!Object<string,parse_css.BlockType>} */
      const atRuleParsingSpec = computeAtRuleParsingSpec(cdataSpec.cssSpec);
      /** @type {!parse_css.Stylesheet} */
      const sheet = parse_css.parseAStylesheet(
          tokenList, atRuleParsingSpec,
          computeAtRuleDefaultParsingSpec(atRuleParsingSpec), cssErrors);
      for (const errorToken of cssErrors) {
        // Override the first parameter with the name of this style tag.
        let params = errorToken.params;
        // Override the first parameter with the name of this style tag.
        params[0] = getDetailOrName(this.tagSpec_);
        context.addErrorWithLineCol(
            new LineCol(errorToken.line, errorToken.col),
            errorToken.code, params, /* url */ '', validationResult);
      }
      const visitor = new InvalidAtRuleVisitor(
          this.tagSpec_, cdataSpec.cssSpec, context, validationResult);
      sheet.accept(visitor);

      // As a hack to not report some errors twice, both via the css parser
      // and via the regular expressions below, we return early if there
      // are parser errors and skip the regular expression errors.
      if (visitor.errorsSeen || cssErrors.length > 0)
      return;
    }
    // } end oneof

    // Blacklisted CDATA Regular Expressions
    for (const blacklist of cdataSpec.blacklistedCdataRegex) {
      if (context.getProgress(validationResult).complete) {
        return;
      }
      const blacklistRegex = new RegExp(blacklist.regex, 'i');
      if (blacklistRegex.test(cdata)) {
        context.addError(
            amp.validator.ValidationError.Code.CDATA_VIOLATES_BLACKLIST,
            /* params */ [getDetailOrName(this.tagSpec_), blacklist.errorMessage],
            this.tagSpec_.specUrl, validationResult);
      }
    }
  }

  /** @param {!LineCol} lineCol */
  setLineCol(lineCol) { this.lineCol_ = lineCol; }

  /** @return {!LineCol} */
  getLineCol() { return this.lineCol_; }
}

/**
 * @param {amp.validator.ValidationError.Code} code
 * @return {amp.validator.ValidationError.Severity}
 */
function SeverityFor(code) {
  if (code === amp.validator.ValidationError.Code.DEPRECATED_TAG) {
    return amp.validator.ValidationError.Severity.WARNING;
  } else if (code === amp.validator.ValidationError.Code.DEPRECATED_ATTR) {
    return amp.validator.ValidationError.Severity.WARNING;
  }
  return amp.validator.ValidationError.Severity.ERROR;
}

/**
 * The Context keeps track of the line / column that the validator is
 * in, as well as the mandatory tag specs that have already been validated.
 * So, this constitutes the mutable state for the validator except for
 * the validation result itself.
 * @private
 */
class Context {
  /**
   * @param {number} maxErrors Maximum number of errors to output. -1 means all.
   */
  constructor(maxErrors) {
    goog.asserts.assert(isInteger(maxErrors),
                        'Unrecognized value for maxErrors.');
    goog.asserts.assert(maxErrors >= -1, 'Unrecognized value for maxErrors.');
    /**
     * Maximum number of errors to return.
     * @type {number}
     * @private
     */
    this.maxErrors_ = maxErrors;
    /**
     * The mandatory alternatives that we've validated.
     * @type {!goog.structs.Set<string>}
     * @private
     */
    this.mandatoryAlternativesSatisfied_ = new goog.structs.Set();
    /**
     * DocLocator object from the parser which gives us line/col numbers.
     * @type {amp.htmlparser.DocLocator}
     * @private
     */
    this.docLocator_ = null;

    this.tagNames_ = new TagNameStack();

    this.cdataMatcher_ = new CdataMatcher(new amp.validator.TagSpec());

    /**
     * @private
     */
    this.tagspecsValidated_ = new goog.structs.Set();
  }

  /**
   * Callback before startDoc which gives us a document locator.
   * @param {!amp.htmlparser.DocLocator} locator
   */
  setDocLocator(locator) { this.docLocator_ = locator; }

  /** @return {amp.htmlparser.DocLocator} */
  getDocLocator() { return this.docLocator_; }

  /**
   * Returns the TagNameStack instance associated with this context.
   * @return {!TagNameStack}
   */
  getTagNames() { return this.tagNames_; }

  /**
   * Returns an object with two fields, complete and wantsMoreErrors. When
   * complete is true, we can exit the validator. This happens only at the end of
   * the document or if the validation has FAILED. wantsMoreErrors returns true
   * if we we haven't hit the required number of errors.
   * @param {!amp.validator.ValidationResult} validationResult
   * @return {!Object<string, boolean>} progress tuple
   */
  getProgress(validationResult) {
    // If maxErrors is set to -1, it means that we want to keep going no
    // matter what, because there may be more errors.
    if (this.maxErrors_ === -1) {
      return { complete: false, wantsMoreErrors: true };
    }

    // For maxErrors set to 0, if the status is FAIL then we know that
    // we are done. Otherwise, we are forced to keep going. This is
    // because in practice, the validator uses PASS as a default value.
    if (this.maxErrors_ === 0) {
      return { complete: validationResult.status ===
          amp.validator.ValidationResult.Status.FAIL,
               wantsMoreErrors: false };
    }

    // For maxErrors > 0, we want to keep going if we haven't seen maxErrors
    // errors yet.
    const wantsMoreErrors = validationResult.errors.length < this.maxErrors_;
    return { complete: !wantsMoreErrors,
             wantsMoreErrors: wantsMoreErrors };
  }

  /**
   * Returns true if the result was changed; false otherwise.
   * @param {LineCol|amp.htmlparser.DocLocator} lineCol a line / column pair.
   * @param {!amp.validator.ValidationError.Code} validationErrorCode Error code
   * @param {!Array<!string>} params
   * @param {string} specUrl a link (URL) to the amphtml spec
   * @param {!amp.validator.ValidationResult} validationResult
   * @return {boolean}
   */
  addErrorWithLineCol(
      lineCol, validationErrorCode, params, specUrl, validationResult) {
    const progress = this.getProgress(validationResult);
    if (progress.complete) {
      goog.asserts.assert(
          validationResult.status === amp.validator.ValidationResult.Status.FAIL,
          'Early PASS exit without full verification.');
      return false;
    }
    const severity = SeverityFor(validationErrorCode);

    // If any of the errors amount to more than a WARNING, validation fails.
    if (severity !== amp.validator.ValidationError.Severity.WARNING) {
      validationResult.status = amp.validator.ValidationResult.Status.FAIL;
    }
    if (progress.wantsMoreErrors) {
      const error = new amp.validator.ValidationError();
      error.severity = severity;
      error.code = validationErrorCode;
      error.params = params;
      error.line = lineCol.getLine();
      error.col = lineCol.getCol();
      error.specUrl = specUrl;
      goog.asserts.assert(validationResult.errors !== undefined);
      validationResult.errors.push(error);
    }
    return true;
  }

  /**
   * Returns true if the result was changed; false otherwise.
   * @param {!amp.validator.ValidationError.Code} validationErrorCode Error code
   * @param {!Array<!string>} params
   * @param {?string} specUrl a link (URL) to the amphtml spec
   * @param {!amp.validator.ValidationResult} validationResult
   * @return {boolean}
   */
  addError(validationErrorCode, params, specUrl, validationResult) {
    if (specUrl === null) {
      specUrl = '';
    }
    return this.addErrorWithLineCol(
        this.docLocator_, validationErrorCode, params, specUrl,
        validationResult);
  }

  /**
   * Records a tag spec that's been validated. This method is only used by
   * ParsedValidatorRules, which by itself does not have any mutable state.
   * @param {number} tagSpecId id of tagSpec to record.
   * @return {boolean} whether or not the tag spec had been encountered before.
   */
  recordTagspecValidated(tagSpecId) {
    const duplicate = this.tagspecsValidated_.contains(tagSpecId);
    if (!duplicate) {
      this.tagspecsValidated_.add(tagSpecId);
    }
    return !duplicate;
  }

  /**
   * @return {!goog.structs.Set<number>}
   */
  getTagspecsValidated() { return this.tagspecsValidated_; }

  /**
   * For use by |ParsedValidatorRules|, which doesn't have any mutable state.
   * @param {string} alternative id of the validated alternative.
   */
  recordMandatoryAlternativeSatisfied(alternative) {
    this.mandatoryAlternativesSatisfied_.add(alternative);
  }

  /**
   * The mandatory alternatives that we've satisfied.
   * @return {!goog.structs.Set<string>}
   */
  getMandatoryAlternativesSatisfied() {
    return this.mandatoryAlternativesSatisfied_;
  }

  /** @return {CdataMatcher} */
  getCdataMatcher() { return this.cdataMatcher_; }

  /** @param {CdataMatcher} matcher */
  setCdataMatcher(matcher) {
    // We store away the position from when the matcher was created
    // so we can use it to generate error messages relating to the opening tag.
    matcher.setLineCol(
        new LineCol(this.docLocator_.getLine(), this.docLocator_.getCol()));
    this.cdataMatcher_ = matcher;
  }
}

/**
 * This wrapper class provides access to an AttrSpec and
 * an attribute id which is unique within its context
 * (e.g., it's unique within the ParsedTagSpec).
 * @private
 */
class ParsedAttrSpec {
  /**
   * @param {!Object} attrSpec
   * @param {number} attrId
   */
  constructor(attrSpec, attrId) {
    /**
     * JSON Attribute Spec dictionary.
     * @type {!Object}
     * @private
     */
    this.spec_ = attrSpec;
    /**
     * Globally unique attribute rule id.
     * @type {number}
     * @private
     */
    this.id_ = attrId;
    /**
     * @type {!goog.structs.Set<string>}
     * @private
     */
    this.valueUrlAllowedProtocols_ = new goog.structs.Set();
    if (this.spec_.valueUrl !== null) {
      for (const protocol of this.spec_.valueUrl.allowedProtocol) {
        this.valueUrlAllowedProtocols_.add(protocol);
      }
    }
    /**
     * @type {!goog.structs.Map<string, !Object>}
     * @private
     */
    this.valuePropertyByName_ = new goog.structs.Map();
    const mandatoryValuePropertyNames = [];
    if (this.spec_.valueProperties !== null) {
      for (const propertySpec of this.spec_.valueProperties.properties) {
        this.valuePropertyByName_.set(propertySpec.name, propertySpec);
        if (propertySpec.mandatory) {
          mandatoryValuePropertyNames.push(propertySpec.name);
        }
      }
    }
    /**
     * @type {!Array<!string>}
     * @private
     */
    this.mandatoryValuePropertyNames_ =
        sortAndUniquify(mandatoryValuePropertyNames);
  }

  /**
   * @return {number} unique for this attr spec.
   */
  getId() { return this.id_; }

  /**
   * @return {!Object} AttrSpec from rules json library.
   */
  getSpec() { return this.spec_; }

  /**
   * @param {!Context} context
   * @param {!string} attrName
   * @param {!string} attrValue
   * @param {!amp.validator.TagSpec} tagSpec
   * @param {!amp.validator.ValidationResult} result
   */
  validateNonTemplateAttrValueAgainstSpec(
      context, attrName, attrValue, tagSpec, result) {
    // The value, value_regex, value_url, and value_properties fields are
    // treated like a oneof, but we're not using oneof because it's
    // a feature that was added after protobuf 2.5.0 (which our
    // open-source version uses).
    // begin oneof {
    if (this.spec_.value !== null) {
      if (attrValue != this.spec_.value) {
        context.addError(
            amp.validator.ValidationError.Code.INVALID_ATTR_VALUE,
            /* params */ [attrName, getDetailOrName(tagSpec), attrValue],
            tagSpec.specUrl, result);
      }
    } else if (this.spec_.valueRegex !== null) {
      const valueRegex =
          new RegExp('^(' + this.spec_.valueRegex + ')$');
      if (!valueRegex.test(attrValue)) {
        context.addError(
            amp.validator.ValidationError.Code.INVALID_ATTR_VALUE,
            /* params */ [attrName, getDetailOrName(tagSpec), attrValue],
            tagSpec.specUrl, result);
      }
    } else if (this.spec_.valueUrl !== null) {
      this.validateAttrValueUrl(context, attrName, attrValue, tagSpec, result);
    } else if (this.spec_.valueProperties !== null) {
      this.validateAttrValueProperties(
          context, attrName, attrValue, tagSpec, result);
    }
    // } end oneof
  }

  /**
   * @param {!Context} context
   * @param {!string} attrName
   * @param {!string} url
   * @param {!amp.validator.TagSpec} tagSpec
   * @param {!amp.validator.ValidationResult} result
   * @private
   */
  validateUrlAndProtocol(context, attrName, url, tagSpec, result) {
    if (url === '') {
      context.addError(
          amp.validator.ValidationError.Code.MISSING_URL,
          /* params */ [attrName, getDetailOrName(tagSpec)],
          tagSpec.specUrl, result);
      return;
    }
    let uri;
    try {
      uri = goog.Uri.parse(url);
    } catch (ex) {
      context.addError(
          amp.validator.ValidationError.Code.INVALID_URL,
          /* params */ [attrName, getDetailOrName(tagSpec), url],
          tagSpec.specUrl, result);
      return;
    }
    if (uri.hasScheme() &&
        !this.valueUrlAllowedProtocols_.contains(uri.getScheme().toLowerCase())) {
      context.addError(
          amp.validator.ValidationError.Code.INVALID_URL_PROTOCOL,
          /* params */ [attrName, getDetailOrName(tagSpec),
                        uri.getScheme().toLowerCase()], tagSpec.specUrl, result);
      return;
    }
  }

  /**
   * @param {!Context} context
   * @param {!string} attrName
   * @param {!string} attrValue
   * @param {!amp.validator.TagSpec} tagSpec
   * @param {!amp.validator.ValidationResult} result
   * @private
   */
  validateAttrValueUrl(context, attrName, attrValue, tagSpec, result) {
    const maybe_uris = new goog.structs.Set();
    if (attrName != 'srcset') {
      maybe_uris.add(goog.string.trim(attrValue));
    } else {
      // TODO: Replace this hack with a parser.
      const segments = goog.string.trim(attrValue).split(',');
      for (const segment of segments) {
        const key_value = goog.string.trim(segment).split(' ');
        // Allow srcsets with missing data, e.g. "img.jpg 2x,"
        if (key_value[0] !== '') {
          maybe_uris.add(goog.string.trim(key_value[0]));
        }
      }
      // TODO: End hack.
    }
    if (maybe_uris.isEmpty()) {
      context.addError(
          amp.validator.ValidationError.Code.MISSING_URL,
          /* params */ [attrName, getDetailOrName(tagSpec)],
          tagSpec.specUrl, result);
      return;
    }
    for (const maybe_uri of maybe_uris.getValues()) {
      const unescaped_maybe_uri = goog.string.unescapeEntities(maybe_uri);
      this.validateUrlAndProtocol(
          context, attrName, unescaped_maybe_uri, tagSpec, result);
      if (result.status === amp.validator.ValidationResult.Status.FAIL) {
        return;
      }
    }
  }

  /**
   * @param {!Context} context
   * @param {!string} attrName
   * @param {!string} attrValue
   * @param {!amp.validator.TagSpec} tagSpec
   * @param {!amp.validator.ValidationResult} result
   * @private
   */
  validateAttrValueProperties(
      context, attrName, attrValue, tagSpec, result) {
    // TODO(johannes): Replace this hack with a parser.
    const segments = attrValue.split(',');
    const properties = new goog.structs.Map();
    for (const segment of segments) {
      const key_value = segment.split('=');
      if (key_value.length < 2) {
        continue;
      }
      properties.set(key_value[0].trim().toLowerCase(), key_value[1]);
    }
    // TODO(johannes): End hack.
    const names = properties.getKeys();
    goog.array.sort(names);
    for (const name of names) {
      const value = properties.get(name);
      if (!this.valuePropertyByName_.containsKey(name)) {
        context.addError(
            amp.validator.ValidationError.Code.DISALLOWED_PROPERTY_IN_ATTR_VALUE,
            /* params */ [name, attrName, getDetailOrName(tagSpec)],
            tagSpec.specUrl, result);
        continue;
      }
      const propertySpec = this.valuePropertyByName_.get(name);
      if (propertySpec.value !== null) {
        if (propertySpec.value != value.toLowerCase()) {
          context.addError(
              amp.validator.ValidationError.Code.
                  INVALID_PROPERTY_VALUE_IN_ATTR_VALUE,
              /* params */ [name, attrName, getDetailOrName(tagSpec), value],
              tagSpec.specUrl, result);
        }
      } else if (propertySpec.valueDouble !== null) {
        if (parseFloat(value) != propertySpec.valueDouble) {
          context.addError(
              amp.validator.ValidationError.Code.
                  INVALID_PROPERTY_VALUE_IN_ATTR_VALUE,
              /* params */ [name, attrName, getDetailOrName(tagSpec), value],
              tagSpec.specUrl, result);
        }
      }
    }
    const notSeen = subtractDiff(this.mandatoryValuePropertyNames_, names);
    for (const name of notSeen) {
      context.addError(
          amp.validator.ValidationError.Code.
              MANDATORY_PROPERTY_MISSING_FROM_ATTR_VALUE,
          /* params */ [name, attrName, getDetailOrName(tagSpec)],
          tagSpec.specUrl, result);
    }
  }
}

/**
 * Collect the AttrSpec pointers for a given |tagspec|.
 * There are four ways to specify attributes:
 * (1) implicitly by a tag spec, if the tag spec has the amp_layout field
 * set - in this case, the AMP_LAYOUT_ATTRS are assumed;
 * (2) within a TagSpec::attrs;
 * (3) via TagSpec::attr_lists which references lists by key;
 * (4) within the $GLOBAL_ATTRS TagSpec::attr_list.
 * It's possible to provide multiple
 * specifications for the same attribute name, but for any given tag only one
 * such specification can be active. The precedence is (1), (2), (3), (4)
 * @param {!Object} tagSpec
 * @param {!goog.structs.Map<string, !amp.validator.AttrList>} rulesAttrMap
 * @return {!Array<!Object>} all of the AttrSpec pointers
 */
function GetAttrsFor(tagSpec, rulesAttrMap) {
  const attrs = [];
  const namesSeen = new goog.structs.Set();
  // (1) layout attrs.
  if (tagSpec.ampLayout !== null) {
    const layoutSpecs = rulesAttrMap.get('$AMP_LAYOUT_ATTRS');
    if (layoutSpecs) {
      for (const spec of layoutSpecs.attrs) {
        if (!namesSeen.contains(spec.name)) {
          namesSeen.add(spec.name);
          attrs.push(spec);
        }
      }
    }
  }
  // (2) attributes specified within |tagSpec|.
  for (const spec of tagSpec.attrs) {
    if (!namesSeen.contains(spec.name)) {
      namesSeen.add(spec.name);
      attrs.push(spec);
    }
  }
  // (3) attributes specified via reference to an attr_list.
  for (const tagSpec_key of tagSpec.attrLists) {
    const specs = rulesAttrMap.get(tagSpec_key);
    goog.asserts.assert(specs !== undefined);
    for (const spec of specs.attrs) {
       if (!namesSeen.contains(spec.name)) {
         namesSeen.add(spec.name);
         attrs.push(spec);
       }
    }
  }
  // (3) attributes specified in the global_attr list.
  const globalSpecs = rulesAttrMap.get('$GLOBAL_ATTRS');
  if (!globalSpecs) {
    return attrs;
  }
  for (const spec of globalSpecs.attrs) {
    if (!namesSeen.contains(spec.name)) {
      namesSeen.add(spec.name);
      attrs.push(spec);
    }
  }
  return attrs;
}


/**
 * A helper function which gets the 'detail' field for an error message,
 * falling back to the tag name if it's not available.
 * @param {?} tagSpec TagSpec instance from the validator.protoscii file.
 * @return {string}
 * @private
 */
function getDetailOrName(tagSpec) {
  return (tagSpec.detail !== null) ? tagSpec.detail : tagSpec.name;
}


/**
 * @param {string} layout
 * @return {!amp.validator.AmpLayout.Layout}
 */
function parseLayout(layout) {
  if (layout === undefined) {
    return amp.validator.AmpLayout.Layout.UNKNOWN;
  }
  const normLayout = layout.toUpperCase().replace('-', '_');
  for (const k in amp.validator.AmpLayout.Layout) {
    if (amp.validator.AmpLayout.Layout[k] == normLayout) {
      return amp.validator.AmpLayout.Layout[k];
    }
  }
  return amp.validator.AmpLayout.Layout.UNKNOWN;
}


/**
 * Parses a width or height layout attribute, for the determining the layout
 * of AMP tags (e.g. <amp-img width="42px" etc.).
 */
amp.validator.CssLengthAndUnit = class {
  /**
   * @param {string|undefined} input The input attribute value to be parsed.
   * @param {boolean} allowAuto Whether or not to allow the 'auto' value as
   *    a value.
   */
  constructor(input, allowAuto) {
    /**
     * Whether the value or unit is invalid. Note that passing
     * undefined as |input| is considered valid.
     * @type {boolean}
     */
    this.isValid = false;
    /**
     * Whether the attribute value is set.
     * @type {boolean}
     */
    this.isSet = false;
    /**
     * Whether the attribute value is 'auto'. This is a special value that
     * indicates that the value gets derived from the context. In practice
     * that's only ever the case for a width.
     * @type {boolean}
     */
    this.isAuto = false;
    /**
     * The unit, 'px' being the default in case it's absent.
     * @type {string}
     */
    this.unit = 'px';

    if (input === undefined) {
      this.isValid = true;
      return;
    }
    this.isSet = true;
    if (input === 'auto') {
      this.isAuto = true;
      this.isValid = allowAuto;
      return;
    }
    const re = new RegExp('^\\d+(?:\\.\\d+)?(px|em|rem|vh|vw|vmin|vmax)?$');
    const match = re.exec(input);
    if (match !== null) {
      this.isValid = true;
      this.unit = match[1] || 'px';
    }
  }
}

/**
 * Calculates the effective width from the input layout and width.
 * This involves considering that some elements, such as amp-audio and
 * amp-pixel, have natural dimensions (browser or implementation-specific
 * defaults for width / height).
 * @param {!amp.validator.AmpLayout} spec
 * @param {!amp.validator.AmpLayout.Layout} inputLayout
 * @param {!amp.validator.CssLengthAndUnit} inputWidth
 * @return {!amp.validator.CssLengthAndUnit}
 */
function CalculateWidth(spec, inputLayout, inputWidth) {
  if ((inputLayout === amp.validator.AmpLayout.Layout.UNKNOWN ||
      inputLayout === amp.validator.AmpLayout.Layout.FIXED) &&
      !inputWidth.isSet && spec.definesDefaultWidth) {
    return new amp.validator.CssLengthAndUnit('1px', /* allowAuto */ false);
  }
  return inputWidth;
}


/**
 * Calculates the effective height from input layout and input height.
 * @param {!amp.validator.AmpLayout} spec
 * @param {!amp.validator.AmpLayout.Layout} inputLayout
 * @param {!amp.validator.CssLengthAndUnit} inputHeight
 * @return {!amp.validator.CssLengthAndUnit}
 */
function CalculateHeight(spec, inputLayout, inputHeight) {
  if ((inputLayout === amp.validator.AmpLayout.Layout.UNKNOWN ||
      inputLayout === amp.validator.AmpLayout.Layout.FIXED ||
      inputLayout === amp.validator.AmpLayout.Layout.FIXED_HEIGHT) &&
      !inputHeight.isSet && spec.definesDefaultHeight) {
    return new amp.validator.CssLengthAndUnit('1px', /* allowAuto */ false);
  }
  return inputHeight;
}

/**
 * Calculates the layout; this depends on the width / height
 * calculation above. It happens last because web designers often make
 * fixed-sized mocks first and then the layout determines how things
 * will change for different viewports / devices / etc.
 * @param {!amp.validator.AmpLayout.Layout} inputLayout
 * @param {!amp.validator.CssLengthAndUnit} width
 * @param {!amp.validator.CssLengthAndUnit} height
 * @param {string?} sizesAttr
 * @param {string?} heightsAttr
 * @return {!amp.validator.AmpLayout.Layout}
 */
function CalculateLayout(inputLayout, width, height, sizesAttr, heightsAttr) {
  if (inputLayout !== amp.validator.AmpLayout.Layout.UNKNOWN) {
    return inputLayout;
  } else if (!width.isSet && !height.isSet) {
    return amp.validator.AmpLayout.Layout.CONTAINER;
  } else if (height.isSet && (!width.isSet || width.isAuto)) {
    return amp.validator.AmpLayout.Layout.FIXED_HEIGHT;
  } else if (
      height.isSet && width.isSet &&
      (sizesAttr !== undefined || heightsAttr !== undefined)) {
    return amp.validator.AmpLayout.Layout.RESPONSIVE;
  } else {
    return amp.validator.AmpLayout.Layout.FIXED;
  }
}


/**
 * We only track (that is, add them to Context.RecordTagspecValidated) validated
 * tagspecs as necessary. That is, if it's needed for document scope validation:
 * - Mandatory tags
 * - Unique tags
 * - Tags (identified by their detail or name) that are required by other tags.
 * @param {!amp.validator.TagSpec} tag
 * @param {!goog.structs.Set<string>} detailOrNamesToTrack
 * @return {!boolean}
 */
function shouldRecordTagspecValidated(tag, detailOrNamesToTrack) {
  return tag.mandatory || tag.unique ||
      getDetailOrName(tag) != null &&
      detailOrNamesToTrack.contains(getDetailOrName(tag));
}

/**
 * This wrapper class provides access to a TagSpec and a tag id
 * which is unique within its context, the ParsedValidatorRules.
 * @private
 */
class ParsedTagSpec {

  /**
   * @param {!string} templateSpecUrl
   * @param {!goog.structs.Map<string, !amp.validator.AttrList>} attrListsByName
   * @param {!goog.structs.Map<string, number>} tagspecIdsByDetailOrName
   * @param {!boolean} shouldRecordTagspecValidated
   * @param {!amp.validator.TagSpec} tagSpec
   * @param {number} tagId
   */
  constructor(templateSpecUrl, attrListsByName, tagspecIdsByDetailOrName,
              shouldRecordTagspecValidated, tagSpec, tagId) {
    /**
     * @type {!amp.validator.TagSpec}
     * @private
     */
    this.spec_ = tagSpec;
    /**
     * Globally unique attribute rule id.
     * @type {number}
     * @private
     */
    this.id_ = tagId;
    /**
     * ParsedAttributes in id order.
     * @type {!Array<!ParsedAttrSpec>}
     * @private
     */
    this.attrsById_ = [];
    /**
     * ParsedAttributes keyed by name.
     * @type {!goog.structs.Map<string, !ParsedAttrSpec>}
     * @private
     */
    this.attrsByName_ = new goog.structs.Map();
    /**
     * Attribute ids that are mandatory for this tag to legally validate.
     * @type {!Array<number>}
     * @private
     */
    this.mandatoryAttrIds_ = [];
    /**
     * @type {!Array<string>}
     * @private
     */
    this.mandatoryOneofs_ = [];
    /**
     * @type {!string}
     * @private
     */
    this.templateSpecUrl_ = templateSpecUrl;
    /**
     * @type {!boolean}
     * @private
     */
    this.shouldRecordTagspecValidated_ = shouldRecordTagspecValidated;
    /**
     * @type {!Array<number>}
     * @private
     */
    this.alsoRequires_ = [];
    /**
     * @type {number}
     * @private
     */
    this.dispatchKeyAttrSpec_ = -1;

    const attrs = GetAttrsFor(tagSpec, attrListsByName);
    for (let i = 0; i < attrs.length; ++i) {
      const parsedAttrSpec = new ParsedAttrSpec(attrs[i], i);
      this.attrsById_.push(parsedAttrSpec);
      this.attrsByName_.set(parsedAttrSpec.getSpec().name, parsedAttrSpec);
      if (parsedAttrSpec.getSpec().mandatory) {
        this.mandatoryAttrIds_.push(i);
      }
      if (parsedAttrSpec.getSpec().mandatoryOneof) {
        this.mandatoryOneofs_.push(parsedAttrSpec.getSpec().mandatoryOneof);
      }
      const altNames = parsedAttrSpec.getSpec().alternativeNames;
      for (const altName of altNames) {
        this.attrsByName_.set(altName, parsedAttrSpec);
      }
      if (parsedAttrSpec.getSpec().dispatchKey) {
        this.dispatchKeyAttrSpec_ = i;
      }
    }
    this.mandatoryOneofs_ = sortAndUniquify(this.mandatoryOneofs_);

    for (const detailOrName of tagSpec.alsoRequires) {
      this.alsoRequires_.push(tagspecIdsByDetailOrName.get(detailOrName));
    }
  }

  /**
   * @return {number} unique id for this tag spec.
   */
  getId() { return this.id_; }

  /**
   * Return the original tag spec. This is the json object representation from
   * amp.validator.rules.
   * @return {!amp.validator.TagSpec}
   */
  getSpec() { return this.spec_; }

  /**
   * A dispatch key is a mandatory attribute name/value unique to this
   * TagSpec. If an encountered tag matches this dispatch key, it is
   * validated first against this TagSpec in order to improve validation
   * performance and error message selection. Not all TagSpecs have a
   * dispatch key.
   * @return {boolean}
   */
  hasDispatchKey() { return this.dispatchKeyAttrSpec_ !== -1; }

  /**
   * You must check hasDispatchKey before accessing
   * @return {string}
   */
  getDispatchKey() {
    goog.asserts.assert(this.hasDispatchKey());
    const parsedSpec = this.attrsById_[this.dispatchKeyAttrSpec_];
    return parsedSpec.getSpec().name + '=' + parsedSpec.getSpec().value;
  }

  /**
   * A TagSpec may specify other tags to be required as well, when that
   * tag is used. This accessor returns the IDs for the tagspecs that
   * are also required if |this| tag occurs in the document.
   * @return {!Array<number>}
   */
  getAlsoRequires() { return this.alsoRequires_; }

  /**
   * Whether or not the tag should be recorded via
   * Context.recordTagspecValidated if it was validated
   * successfullly. For performance, this is only done for tags that are
   * mandatory, unique, or possibly required by some other tag.
   * @return {boolean}
   */
  shouldRecordTagspecValidated() {
    return this.shouldRecordTagspecValidated_;
  }

  /**
   * Returns true if |value| contains mustache template syntax.
   * @param {!string} value
   * @return {boolean}
   */
  static valueHasTemplateSyntax(value) {
    // Mustache (https://mustache.github.io/mustache.5.html), our template
    // system, supports replacement tags that start with {{ and end with }}.
    // We relax attribute value rules if the value contains this syntax as we
    // will validate the post-processed tag instead.
    const mustacheTag = new RegExp('{{.*}}');
    return mustacheTag.test(value);
  }

  /**
   * Returns true if |value| contains a mustache unescaped template syntax.
   * @param {!string} value
   * @return {boolean}
   */
  static valueHasUnescapedTemplateSyntax(value) {
    // Mustache (https://mustache.github.io/mustache.5.html), our template
    // system, supports {{{unescaped}}} or {{{&unescaped}}} and there can
    // be whitespace after the 2nd '{'. We disallow these in attribute Values.
    const unescapedOpenTag = new RegExp('{{\\s*[&{]');
    return unescapedOpenTag.test(value);
  }

  /**
   * Returns true if |value| contains a mustache partials template syntax.
   * @param {!string} value
   * @return {boolean}
   */
  static valueHasPartialsTemplateSyntax(value) {
    // Mustache (https://mustache.github.io/mustache.5.html), our template
    // system, supports 'partials' which include other Mustache templates
    // in the format of {{>partial}} and there can be whitespace after the {{.
    // We disallow partials in attribute values.
    const partialsTag = new RegExp('{{\\s*>');
    return partialsTag.test(value);
  }

  /**
   * Validates the layout for the given tag. This involves checking the
   * layout, width, height, sizes attributes with AMP specific logic.
   * @param {!Context} context
   * @param {!goog.structs.Map<string, string>} attrsByKey
   * @param {!amp.validator.ValidationResult} result
   */
  validateLayout(context, attrsByKey, result) {
    goog.asserts.assert(this.spec_.ampLayout != null);

    const layoutAttr = attrsByKey.get('layout');
    const widthAttr = attrsByKey.get('width');
    const heightAttr = attrsByKey.get('height');
    const sizesAttr = attrsByKey.get('sizes');
    const heightsAttr = attrsByKey.get('heights');

    // Parse the input layout attributes which we found for this tag.
    const inputLayout = parseLayout(layoutAttr);
    if (layoutAttr !== undefined &&
        inputLayout === amp.validator.AmpLayout.Layout.UNKNOWN) {
      context.addError(
          amp.validator.ValidationError.Code.INVALID_ATTR_VALUE,
          /* params */['layout', getDetailOrName(this.spec_), layoutAttr],
          this.spec_.specUrl, result);
      return;
    }
    const inputWidth = new amp.validator.CssLengthAndUnit(
        widthAttr, /* allowAuto */ true);
    if (!inputWidth.isValid) {
      context.addError(
          amp.validator.ValidationError.Code.INVALID_ATTR_VALUE,
          /* params */['width', getDetailOrName(this.spec_), widthAttr],
          this.spec_.specUrl, result);
      return;
    }
    const inputHeight = new amp.validator.CssLengthAndUnit(
        heightAttr, /* allowAuto */ false);
    if (!inputHeight.isValid) {
      context.addError(
          amp.validator.ValidationError.Code.INVALID_ATTR_VALUE,
          /* params */['height', getDetailOrName(this.spec_), heightAttr],
          this.spec_.specUrl, result);
      return;
    }

    // Now calculate the effective layout attributes.
    const width = CalculateWidth(this.spec_.ampLayout, inputLayout, inputWidth);
    const height = CalculateHeight(this.spec_.ampLayout, inputLayout,
                                   inputHeight);
    const layout =
        CalculateLayout(inputLayout, width, height, sizesAttr, heightsAttr);

    // Does the tag support the computed layout?
    if (this.spec_.ampLayout.supportedLayouts.indexOf(layout) === -1) {
      const code = layoutAttr === undefined ?
          amp.validator.ValidationError.Code.IMPLIED_LAYOUT_INVALID :
          amp.validator.ValidationError.Code.SPECIFIED_LAYOUT_INVALID;
      context.addError(code, /* params */ [layout, getDetailOrName(this.spec_)],
                       this.spec_.specUrl, result);
      return;
    }
    // Check other constraints imposed by the particular layouts.
    if ((layout === amp.validator.AmpLayout.Layout.FIXED ||
        layout === amp.validator.AmpLayout.Layout.FIXED_HEIGHT ||
        layout === amp.validator.AmpLayout.Layout.RESPONSIVE) &&
        !height.isSet) {
      context.addError(amp.validator.ValidationError.Code.MANDATORY_ATTR_MISSING,
                       /* params */ ['height', getDetailOrName(this.spec_)],
                       this.spec_.specUrl, result);
      return;
    }
    if (layout === amp.validator.AmpLayout.Layout.FIXED_HEIGHT &&
        width.isSet && !width.isAuto) {
      context.addError(
          amp.validator.ValidationError.Code.ATTR_VALUE_REQUIRED_BY_LAYOUT,
          /* params */ [widthAttr, 'width', getDetailOrName(this.spec_),
                        'FIXED_HEIGHT', 'auto'],
          this.spec_.specUrl, result);
      return;
    }
    if (layout === amp.validator.AmpLayout.Layout.FIXED ||
        layout === amp.validator.AmpLayout.Layout.RESPONSIVE) {
      if (!width.isSet) {
        context.addError(
            amp.validator.ValidationError.Code.MANDATORY_ATTR_MISSING,
            /* params */ ['width', getDetailOrName(this.spec_)],
            this.spec_.specUrl, result);
        return;
      } else if (width.isAuto) {
        context.addError(
            amp.validator.ValidationError.Code.INVALID_ATTR_VALUE,
            /* params */ ['width', getDetailOrName(this.spec_), 'auto'],
            this.spec_.specUrl, result);
        return;
      }
    }
    if (layout === amp.validator.AmpLayout.Layout.RESPONSIVE &&
        width.unit !== height.unit) {
      context.addError(
          amp.validator.ValidationError.Code.
              INCONSISTENT_UNITS_FOR_WIDTH_AND_HEIGHT,
          /* params */ [getDetailOrName(this.spec_), width.unit, height.unit],
          this.spec_.specUrl, result);
      return;
    }
    if (heightsAttr !== undefined &&
        layout !== amp.validator.AmpLayout.Layout.RESPONSIVE) {
      const code = layoutAttr === undefined ?
          amp.validator.ValidationError.Code.ATTR_DISALLOWED_BY_IMPLIED_LAYOUT :
          amp.validator.ValidationError.Code.ATTR_DISALLOWED_BY_SPECIFIED_LAYOUT;
      context.addError(
          code, /* params */['heights', getDetailOrName(this.spec_), layout],
          this.spec_.specUrl, result);
      return;
    }
  }

  /**
   * Helper method for ValidateAttributes, for when an attribute is
   * encountered which is not specified by the validator.protoascii
   * specification.
   * @param {!Context} context
   * @param {!string} attrName
   * @param {!amp.validator.ValidationResult} result
   */
  validateAttrNotFoundInSpec(context, attrName, result) {
    // For now, we just skip data- attributes in the validator, because
    // our schema doesn't capture which ones would be ok or not. E.g.
    // in practice, some type of ad or perhaps other custom elements require
    // particular data attributes.
    // http://www.w3.org/TR/html5/single-page.html#attr-data-*
    // http://w3c.github.io/aria-in-html/
    // However, mostly to avoid confusion, we want to make sure that
    // nobody tries to make a Mustache template data attribute,
    // e.g. <div data-{{foo}}>, so we also exclude those characters.
    if (goog.string./*OK*/startsWith(attrName, 'data-') &&
        !goog.string.contains(attrName, '}') &&
        !goog.string.contains(attrName, '{')) {
      return;
    }

    // At this point, it's an error either way, but we try to give a
    // more specific error in the case of Mustache template characters.
    if (attrName.indexOf('{{') != -1) {
      context.addError(
          amp.validator.ValidationError.Code.TEMPLATE_IN_ATTR_NAME,
          /* params */ [attrName, getDetailOrName(this.spec_)],
          this.templateSpecUrl_, result);
    } else {
      context.addError(
          amp.validator.ValidationError.Code.DISALLOWED_ATTR,
          /* params */ [attrName, getDetailOrName(this.spec_)],
          this.spec_.specUrl, result);
    }
  }

  /**
   * Specific checks for attribute values descending from a template tag.
   * @param {!Context} context
   * @param {!string} attrName
   * @param {!string} attrValue
   * @param {!amp.validator.ValidationResult} result
   */
  validateAttrValueBelowTemplateTag(context, attrName, attrValue, result) {
    if (ParsedTagSpec.valueHasUnescapedTemplateSyntax(attrValue)) {
      context.addError(
          amp.validator.ValidationError.Code.UNESCAPED_TEMPLATE_IN_ATTR_VALUE,
          /* params */ [attrName, getDetailOrName(this.spec_), attrValue],
          this.templateSpecUrl_, result);
    } else if (ParsedTagSpec.valueHasPartialsTemplateSyntax(attrValue)) {
      context.addError(
          amp.validator.ValidationError.Code.TEMPLATE_PARTIAL_IN_ATTR_VALUE,
          /* params */ [attrName, getDetailOrName(this.spec_), attrValue],
          this.templateSpecUrl_, result);
    }
  }

  /**
   * Validates whether the attributes set on |encountered_tag| conform to this
   * tag specification. All mandatory attributes must appear. Only attributes
   * explicitly mentioned by this tag spec may appear.
   *  Returns true iff the validation is successful.
   * @param {!Context} context
   * @param {!Array<string>} encounteredAttrs Alternating key/value pain the array
   * @param {!amp.validator.ValidationResult} result
   */
  validateAttributes(context, encounteredAttrs, result) {
    if (this.spec_.ampLayout !== null) {
      const attrsByKey = new goog.structs.Map();
      for (let i = 0; i < encounteredAttrs.length; i += 2) {
        attrsByKey.set(encounteredAttrs[i], encounteredAttrs[i + 1]);
      }
      this.validateLayout(context, attrsByKey, result);
      if (result.status === amp.validator.ValidationResult.Status.FAIL) {
        return;
      }
    }
    const hasTemplateAncestor = context.getTagNames().hasAncestor('template');
    let mandatoryAttrsSeen = [];
    /** @type {!goog.structs.Set<string>} */
    const mandatoryOneofsSeen = new goog.structs.Set();
    // Our html parser delivers attributes as an array of alternating keys and
    // values. We skip over this array 2 at a time to iterate over the keys.
    for (let i = 0; i < encounteredAttrs.length; i += 2) {
      const attrKey = encounteredAttrs[i];
      const attrName = attrKey.toLowerCase();
      let attrValue = encounteredAttrs[i + 1];

      // Our html parser repeats the key as the value if there is no value. We
      // replace the value with an empty string instead in this case.
      if (attrKey === attrValue)
      attrValue = '';

      const parsedSpec = this.attrsByName_.get(attrName);
      if (parsedSpec === undefined) {
        this.validateAttrNotFoundInSpec(context, attrName, result);
        if (result.status === amp.validator.ValidationResult.Status.FAIL) {
          return;
        }
        continue;
      }
      if (hasTemplateAncestor) {
        this.validateAttrValueBelowTemplateTag(
            context, attrName, attrValue, result);
        if (result.status === amp.validator.ValidationResult.Status.FAIL) {
          return;
        }
      }
      if (parsedSpec.getSpec().deprecation !== null) {
        context.addError(
            amp.validator.ValidationError.Code.DEPRECATED_ATTR,
            /* params */ [attrName, getDetailOrName(this.spec_),
                          parsedSpec.getSpec().deprecation],
            parsedSpec.getSpec().deprecationUrl, result);
        // Deprecation is only a warning, so we don't return.
      }
      if (!hasTemplateAncestor ||
          !ParsedTagSpec.valueHasTemplateSyntax(attrValue)) {
        parsedSpec.validateNonTemplateAttrValueAgainstSpec(
            context, attrName, attrValue, this.spec_, result);
        if (result.status === amp.validator.ValidationResult.Status.FAIL) {
          return;
        }
      }
      if (parsedSpec.getSpec().blacklistedValueRegex !== null) {
        const blacklistedValueRegex = new RegExp(
            parsedSpec.getSpec().blacklistedValueRegex, 'i');
        if (blacklistedValueRegex.test(attrValue)) {
          context.addError(
              amp.validator.ValidationError.Code.INVALID_ATTR_VALUE,
              /* params */ [attrName, getDetailOrName(this.spec_),
                            attrValue],
              this.spec_.specUrl, result);
          return;
        }
      }
      if (parsedSpec.getSpec().mandatory) {
        mandatoryAttrsSeen.push(parsedSpec.getId());
      }
      // The "at most 1" part of mandatory_oneof: mandatory_oneof
      // wants exactly one of the alternatives, so here
      // we check whether we already saw another alternative
      if (parsedSpec.getSpec().mandatoryOneof &&
          mandatoryOneofsSeen.contains(parsedSpec.getSpec().mandatoryOneof)) {
        context.addError(
            amp.validator.ValidationError.Code.MUTUALLY_EXCLUSIVE_ATTRS,
            /* params */ [getDetailOrName(this.spec_),
                          parsedSpec.getSpec().mandatoryOneof],
            this.spec_.specUrl, result);
        return;
      }
      mandatoryOneofsSeen.add(parsedSpec.getSpec().mandatoryOneof);
    }
    // The "at least 1" part of mandatory_oneof: If none of the
    // alternatives were present, we report that an attribute is missing.
    for (const mandatoryOneof of this.mandatoryOneofs_) {
      if (!mandatoryOneofsSeen.contains(mandatoryOneof)) {
        context.addError(
            amp.validator.ValidationError.Code.MANDATORY_ONEOF_ATTR_MISSING,
            /* params */ [getDetailOrName(this.spec_), mandatoryOneof],
            this.spec_.specUrl, result);
      }
    }
    mandatoryAttrsSeen = sortAndUniquify(mandatoryAttrsSeen);
    const diffs = subtractDiff(this.mandatoryAttrIds_, mandatoryAttrsSeen);
    for (const diff of diffs) {
      context.addError(
          amp.validator.ValidationError.Code.MANDATORY_ATTR_MISSING,
          /* params */ [this.attrsById_[diff].getSpec().name,
                        getDetailOrName(this.spec_)],
          this.spec_.specUrl, result);
    }
  }

  /**
   * Validates whether the parent tag satisfied the spec (e.g., some
   * tags can only appear in head).
   * @param {!Context} context
   * @param {!amp.validator.ValidationResult} validationResult
   */
  validateParentTag(context, validationResult) {
    if (this.spec_.mandatoryParent !== null &&
        this.spec_.mandatoryParent !== context.getTagNames().getParent()) {

      // Output a parent/child error using CSS Child Selector syntax which is
      // both succinct and should be well understood by web developers.
      context.addError(
          amp.validator.ValidationError.Code.WRONG_PARENT_TAG,
          /* params */ [this.spec_.name, context.getTagNames().getParent(),
                        this.spec_.mandatoryParent],
          this.spec_.specUrl, validationResult);
    }
  }

  /**
   * Validates if the tag ancestors satisfied the spec.
   * @param {!Context} context
   * @param {!amp.validator.ValidationResult} validationResult
   */
  validateAncestorTags(context, validationResult) {
    if (this.spec_.mandatoryAncestor !== null) {
      const mandatoryAncestor = this.spec_.mandatoryAncestor;
      if (!context.getTagNames().hasAncestor(mandatoryAncestor)) {
        if (this.spec_.mandatoryAncestorSuggestedAlternative !== null) {
          context.addError(
              amp.validator.ValidationError.Code.MANDATORY_TAG_ANCESTOR_WITH_HINT,
              /* params */ [this.spec_.name, mandatoryAncestor,
                            this.spec_.mandatoryAncestorSuggestedAlternative],
              this.spec_.specUrl, validationResult);
        } else {
          context.addError(
              amp.validator.ValidationError.Code.MANDATORY_TAG_ANCESTOR,
              /* params */ [this.spec_.name, mandatoryAncestor],
              this.spec_.specUrl, validationResult);
        }
        return;
      }
    }
    for (const disallowedAncestor of this.spec_.disallowedAncestor) {
      if (context.getTagNames().hasAncestor(disallowedAncestor)) {
        context.addError(
            amp.validator.ValidationError.Code.DISALLOWED_TAG_ANCESTOR,
            /* params */ [this.spec_.name, disallowedAncestor],
            this.spec_.specUrl, validationResult);
        return;
      }
    }
  }
}

/**
 * This small class (struct) stores the dispatch rules for all TagSpecs
 * with the same tag name.
 * @private
 */
class TagSpecDispatch {
  /** Creates an empty instance. */
  constructor() {
    /**
     * TagSpecs for a specific attribute name/value dispatch key.
     * @type {!goog.structs.Map<!Array<string>, number>}
     * @public
     */
    this.tagSpecsByDispatch = new goog.structs.Map();
    /**
     * @type {!Array<number>}
     * @public
     */
    this.allTagSpecs = [];
  }
}

/**
 * This wrapper class provides access to the validation rules.
 * @private
 */
class ParsedValidatorRules {
  /** Creates a new instance and initializes it with
   * amp.validator.ValidatorRules. */
  constructor() {
    /**
     * ParsedTagSpecs in id order.
     * @type {!Array<!ParsedTagSpec>}
     * @private
     */
    this.tagSpecById_ = [];
    /**
     * ParsedTagSpecs keyed by name
     * @type {!goog.structs.Map<string, !TagSpecDispatch>}
     * @private
     */
    this.tagSpecByTagName_ = new goog.structs.Map();
    /**
     * Tag ids that are mandatory for a document to legally validate.
     * @type {!Array<number>}
     * @private
     */
    this.mandatoryTagSpecs_ = [];

    /** @type {!amp.validator.ValidatorRules} */
    const rules = amp.validator.RULES;

    /** @type {!goog.structs.Map<string, !amp.validator.AttrList>} */
    const attrListsByName = new goog.structs.Map();
    for (const attrList of rules.attrLists) {
      attrListsByName.set(attrList.name, attrList);
    }

    /** @type {!goog.structs.Map<string, number>} */
    const tagspecIdsByDetailOrName = new goog.structs.Map();
    /** @type {!goog.structs.Set<string>} */
    const detailOrNamesToTrack = new goog.structs.Set();
    for (let i = 0; i < rules.tags.length; ++i) {
      const tag = rules.tags[i];
      goog.asserts.assert(
          !tagspecIdsByDetailOrName.containsKey(getDetailOrName(tag)));
      tagspecIdsByDetailOrName.set(getDetailOrName(tag), i);
      if (tag.alsoRequires.length > 0) {
        detailOrNamesToTrack.add(getDetailOrName(tag));
      }
      for (const alsoRequires of tag.alsoRequires) {
        detailOrNamesToTrack.add(alsoRequires);
      }
    }

    for (let i = 0; i < rules.tags.length; ++i) {
      const tag = rules.tags[i];
      goog.asserts.assert(rules.templateSpecUrl != null);
      const parsedTagSpec = new ParsedTagSpec(
          rules.templateSpecUrl, attrListsByName, tagspecIdsByDetailOrName,
          shouldRecordTagspecValidated(tag, detailOrNamesToTrack), tag, i);
      this.tagSpecById_.push(parsedTagSpec);
      goog.asserts.assert(tag.name !== null);
      if (!this.tagSpecByTagName_.containsKey(tag.name)) {
        this.tagSpecByTagName_.set(tag.name, new TagSpecDispatch());
      }
      const tagnameDispatch = this.tagSpecByTagName_.get(tag.name);
      if (parsedTagSpec.hasDispatchKey())
      tagnameDispatch.tagSpecsByDispatch.set(parsedTagSpec.getDispatchKey(), i);
      tagnameDispatch.allTagSpecs.push(parsedTagSpec);
      if (tag.mandatory)
      this.mandatoryTagSpecs_.push(i);
    }
    /** type {!goog.structs.Map<!amp.validator.ValidationError.Code, !string>} */
    this.formatByCode_ = new goog.structs.Map();
    for (let i = 0; i < rules.errorFormats.length; ++i) {
      const errorFormat = rules.errorFormats[i];
      goog.asserts.assert(errorFormat !== null);
      this.formatByCode_.set(errorFormat.code, errorFormat.format);
    }
  }

  /**
   * @return {!goog.structs.Map<!amp.validator.ValidationError.Code, !string>}
   */
  getFormatByCode() { return this.formatByCode_; }

  /**
   * Validates the provided |tagName| with respect to the tag
   * specifications that are part of this instance. At least one
   * specification must validate. The ids for mandatory tag specs are
   * emitted via context.recordTagspecValidated().
   * @param {!Context} context
   * @param {string} tagName
   * @param {!Array<string>} encounteredAttrs Alternating key/value pain the array
   * @param {!amp.validator.ValidationResult} validationResult
   */
  validateTag(context, tagName, encounteredAttrs, validationResult) {
    const tagSpecDispatch = this.tagSpecByTagName_.get(tagName);
    if (tagSpecDispatch === undefined) {
      context.addError(amp.validator.ValidationError.Code.DISALLOWED_TAG,
                       /* params */ [tagName], /* specUrl */ '', validationResult);
      return;
    }
    let resultForBestAttempt = new amp.validator.ValidationResult();
    resultForBestAttempt.status = amp.validator.ValidationResult.Status.FAIL;
    // Attempt to validate against dispatched tagspecs first.
    if (!tagSpecDispatch.tagSpecsByDispatch.isEmpty()) {
      for (let i = 0; i < encounteredAttrs.length; i += 2) {
        let attrName = encounteredAttrs[i];
        let attrValue = encounteredAttrs[i + 1];
        // Our html parser repeats the key as the value if there is no value. We
        // replace the value with an empty string instead in this case.
        if (attrName === attrValue)
        attrValue = '';
        attrName = attrName.toLowerCase();

        const match = tagSpecDispatch.tagSpecsByDispatch.get(
            attrName + '=' + attrValue);
        if (match !== undefined) {
          const parsedSpec = this.tagSpecById_[match];
          this.validateTagAgainstSpec(parsedSpec, context, encounteredAttrs,
                                      resultForBestAttempt);
          if (resultForBestAttempt.status !==
              amp.validator.ValidationResult.Status.FAIL) {
            validationResult.mergeFrom(resultForBestAttempt);
            return;  // Exit early on success
          }
        }
      }
    }
    // Validate against all tagspecs if we still haven't matched.
    if (resultForBestAttempt.status ===
        amp.validator.ValidationResult.Status.FAIL) {
      for (const parsedSpec of tagSpecDispatch.allTagSpecs) {
        this.validateTagAgainstSpec(parsedSpec, context, encounteredAttrs,
                                    resultForBestAttempt);
        if (resultForBestAttempt.status !==
            amp.validator.ValidationResult.Status.FAIL) {
          validationResult.mergeFrom(resultForBestAttempt);
          return;  // Exit early on success
        }
      }
    }
    validationResult.mergeFrom(resultForBestAttempt);
  }

  /**
   * Validates the provided |tagName| with respect to a single tag specification.
   * @param {!ParsedTagSpec} parsedSpec
   * @param {!Context} context
   * @param {!Array<string>} encounteredAttrs Alternating key/value pain the array
   * @param {!amp.validator.ValidationResult} resultForBestAttempt
   */
  validateTagAgainstSpec(
      parsedSpec, context, encounteredAttrs, resultForBestAttempt) {
    goog.asserts.assert(resultForBestAttempt.status ===
        amp.validator.ValidationResult.Status.FAIL);
    let resultForAttempt = new amp.validator.ValidationResult();
    resultForAttempt.status = amp.validator.ValidationResult.Status.UNKNOWN;
    parsedSpec.validateAttributes(context, encounteredAttrs, resultForAttempt);
    parsedSpec.validateParentTag(context, resultForAttempt);
    parsedSpec.validateAncestorTags(context, resultForAttempt);

    if (resultForAttempt.status === amp.validator.ValidationResult.Status.FAIL) {
      if (maxSpecificity(resultForAttempt) >
          maxSpecificity(resultForBestAttempt)) {
        resultForBestAttempt.status = resultForAttempt.status;
        resultForBestAttempt.errors = resultForAttempt.errors;
      }
      return;
    }
    // This is the successful branch of the code: locally the tagspec matches.
    resultForBestAttempt.status = resultForAttempt.status;
    resultForBestAttempt.errors = resultForAttempt.errors;

    if (parsedSpec.shouldRecordTagspecValidated()) {
      const isUnique = context.recordTagspecValidated(parsedSpec.getId());
      // If a duplicate tag is encountered for a spec that's supposed
      // to be unique, we've found an error that we must report.
      if (parsedSpec.getSpec().unique && !isUnique) {
        const spec = parsedSpec.getSpec();
        context.addError(
            amp.validator.ValidationError.Code.DUPLICATE_UNIQUE_TAG,
            /* params */ [getDetailOrName(spec)], spec.specUrl,
            resultForBestAttempt);
        return;
      }
    }

    if (parsedSpec.getSpec().mandatoryAlternatives !== null) {
      const satisfied = parsedSpec.getSpec().mandatoryAlternatives;
      goog.asserts.assert(satisfied !== null);
      context.recordMandatoryAlternativeSatisfied(satisfied);
    }
    // (Re)set the cdata matcher to the expectations that this tag
    // brings with it.
    context.setCdataMatcher(new CdataMatcher(parsedSpec.getSpec()));
  }

  /**
   * Emits errors for tags that are specified to be mandatory.
   * @param {!Context} context
   * @param {!amp.validator.ValidationResult} validationResult
   */
  maybeEmitMandatoryTagValidationErrors(context, validationResult) {
    for (const tagspecId of this.mandatoryTagSpecs_) {
      if (!context.getTagspecsValidated().contains(tagspecId)) {
        const spec = this.tagSpecById_[tagspecId].getSpec();
        if (!context.addError(
            amp.validator.ValidationError.Code.MANDATORY_TAG_MISSING,
            /* params */ [getDetailOrName(spec)],
            spec.specUrl, validationResult)) {
          return;
        }
      }
    }
  }

  /**
   * Emits errors for tags that specify that another tag is also required.
   * Returns false iff context->Progress(result).complete.
   * @param {!Context} context
   * @param {!amp.validator.ValidationResult} validationResult
   */
  maybeEmitAlsoRequiresValidationErrors(context, validationResult) {
    let tagspecsValidated = context.getTagspecsValidated().getValues();
    goog.array.sort(tagspecsValidated);
    for (const tagspecId of tagspecsValidated) {
      const spec = this.tagSpecById_[tagspecId];
      for (const alsoRequiresTagspecId of spec.getAlsoRequires()) {
        if (!context.getTagspecsValidated().contains(alsoRequiresTagspecId)) {
          const alsoRequiresSpec = this.tagSpecById_[alsoRequiresTagspecId];
          if (!context.addError(
              amp.validator.ValidationError.Code.TAG_REQUIRED_BY_MISSING,
              /* params */ [getDetailOrName(
                  alsoRequiresSpec.getSpec()), getDetailOrName(spec.getSpec())],
              spec.getSpec().specUrl,
              validationResult)) {
            return;
          }
        }
      }
    }
  }

  /**
   * Emits errors for tags that are specified as mandatory alternatives.
   * Returns false iff context->Progress(result).complete.
   * @param {!Context} context
   * @param {!amp.validator.ValidationResult} validationResult
   */
  maybeEmitMandatoryAlternativesSatisfiedErrors(context, validationResult) {
    const satisfied = context.getMandatoryAlternativesSatisfied();
    /** @type {!Array<string>} */
    let missing = [];
    const specUrlsByMissing = {};
    for (const tagSpec of this.tagSpecById_) {
      const spec = tagSpec.getSpec();
      if (spec.mandatoryAlternatives !== null) {
        const alternative = spec.mandatoryAlternatives;
        if (!satisfied.contains(alternative)) {
          missing.push(alternative);
          specUrlsByMissing[alternative] = spec.specUrl;
        }
      }
    }
    for (const tagMissing of sortAndUniquify(missing)) {
      if (!context.addError(
          amp.validator.ValidationError.Code.MANDATORY_TAG_MISSING,
          /* params */ [tagMissing], /* specUrl */ specUrlsByMissing[tagMissing],
          validationResult)) {
        return;
      }
    }
  }

  /**
   * Emits any validation errors which require a global view
   * (mandatory tags, tags required by other tags, mandatory alternatives).
   * @param {!Context} context
   * @param {!amp.validator.ValidationResult} validationResult
   */
  maybeEmitGlobalTagValidationErrors(context, validationResult) {
    if (context.getProgress(validationResult).complete)
    return;
    this.maybeEmitMandatoryTagValidationErrors(context, validationResult);
    if (context.getProgress(validationResult).complete)
    return;
    this.maybeEmitAlsoRequiresValidationErrors(context, validationResult);
    if (context.getProgress(validationResult).complete)
    return;
    this.maybeEmitMandatoryAlternativesSatisfiedErrors(context, validationResult);
  }
}

const parsedValidatorRulesSingleton = new ParsedValidatorRules();

/**
 * Computes the byte length, rather than character length, of a utf8 string.
 * https://en.wikipedia.org/wiki/UTF-8
 * @param {string} utf8Str
 * @return {number}
 */
function byteLength(utf8Str) {
  // To figure out which characters are multi-byte we can abuse
  // encodeURIComponent which will escape those specific characters.
  const multiByteEscapedChars = encodeURIComponent(utf8Str).match(/%[89ABab]/g);
  if (multiByteEscapedChars === null) {
    return utf8Str.length;
  } else {
    return utf8Str.length + multiByteEscapedChars.length;
  }
}

/**
 * Validation Handler which accepts callbacks from HTML Parser
 * @private
 */
class ValidationHandler extends amp.htmlparser.HtmlSaxHandlerWithLocation {
  /** Creates a new handler. */
  constructor() {
    this.validationResult_ = new amp.validator.ValidationResult();
    this.validationResult_.status = amp.validator.ValidationResult.Status.UNKNOWN;
    // TODO(greggrothaus): plumb maxErrors all the way back to our API so the
    // test can exercise the different options or get rid of maxErrors
    // altogether.
    /**
     * Validation Context.
     * @type {!Context}
     * @private
     */
    this.context_ = new Context(/* maxErrors */-1);
    /**
     * Rules from parsed JSON configuration.
     * @type {!ParsedValidatorRules}
     * @private
     */
    this.rules_ = parsedValidatorRulesSingleton;

    /**
     * Set to true when we encounter a start <style> tag, false when we encounter
     * an end <style> tag.
     * @type {boolean}
     * @private
     */
    this.inCssRegion_ = false;
  }

  /**
   * @return {!amp.validator.ValidationResult} Validation Result at the current
   *     step.
   */
  Result() { return this.validationResult_; }

  /**
   * Callback before startDoc which gives us a document locator.
   * @param {amp.htmlparser.DocLocator} locator
   * @override
   */
  setDocLocator(locator) {
    if (locator == null) {
      goog.asserts.fail('Null DocLocator set');
    } else {
      this.context_.setDocLocator(locator);
    }
  }

  /**
   * Callback for the start of a new HTML document.
   * @override
   */
  startDoc() {
    this.validationResult_ = new amp.validator.ValidationResult();
    this.validationResult_.status = amp.validator.ValidationResult.Status.UNKNOWN;
  }

  /**
   * Callback for the end of a new HTML document. Triggers validation of mandatory
   * tag presence.
   */
  endDoc() {
    if (this.context_.getProgress(this.validationResult_).complete)
    return;
    this.context_.setCdataMatcher(new CdataMatcher(new amp.validator.TagSpec()));
    this.rules_.maybeEmitGlobalTagValidationErrors(
        this.context_, this.validationResult_);
    if (this.validationResult_.status ===
        amp.validator.ValidationResult.Status.UNKNOWN)
    this.validationResult_.status =
        amp.validator.ValidationResult.Status.PASS;
  }

  /**
   * Callback for a start HTML tag.
   * @param {string} tagName ie: 'table' (already lower-cased by htmlparser.js).
   * @param {Array<string>} attrs Alternating key/value pain the array
   * @override
   */
  startTag(tagName, attrs) {
    goog.asserts.assert(attrs !== null, 'Null attributes for tag: ' + tagName);
    this.context_.setCdataMatcher(new CdataMatcher(new amp.validator.TagSpec()));
    if (this.context_.getProgress(this.validationResult_).complete)
    return;
    this.context_.getTagNames().enterTag(tagName);
    this.rules_.validateTag(this.context_, tagName, attrs,
                            this.validationResult_);
    if (tagName === 'style')
    this.inCssRegion_ = true;
  }

  /**
   * Callback for an end HTML tag.
   * @param {string} tagName ie: 'table'
   * @override
   */
  endTag(tagName) {
    this.context_.setCdataMatcher(new CdataMatcher(new amp.validator.TagSpec()));
    this.context_.getTagNames().exitTag(tagName);
  };

  /**
   * Callback for pcdata. I'm not sure what this is supposed to include, but it
   * seems to be called for contents of <p> tags, looking at a few examples.
   * @param {string} text
   * @override
   */
  pcdata(text) {}

  /**
   * Callback for rcdata text. rcdata text includes contents of title or textarea
   * tags. The validator has no specific rules regarding these text blobs.
   * @param {string} text
   * @override
   */
  rcdata(text) {}

  /**
   * Callback for cdata.
   * @param {string} text
   * @override
   */
  cdata(text) {
    this.context_.getCdataMatcher().match(
        text, this.context_, this.validationResult_);
  }
}

/**
 * Validates an document input as a string.
 * @param {string} inputDocContents
 * @return {!amp.validator.ValidationResult} Validation Result (status and
 *     errors)
 * @export
 */
amp.validator.validateString = function(inputDocContents) {
  goog.asserts.assertString(inputDocContents,
      'Input document is not a string');

  const handler = new ValidationHandler();
  const parser = new amp.htmlparser.HtmlParser();
  parser.parse(handler, inputDocContents);

  // TODO: This returns SUCCESS even if there are errors. Should be fixed.
  return handler.Result();
};

/**
 * Applies the format to render the params in the provided error.
 * @param {!string} format
 * @param {!amp.validator.ValidationError} error
 * @return {!string}
 */
function applyFormat(format, error) {
  let message = format;
  for (let param = 1; param <= error.params.length; ++param) {
    message = message.replace(new RegExp('%' + param, 'g'),
                              error.params[param - 1]);
  }
  return message.replace(new RegExp('%%', 'g'), '%');
}

/**
 * Renders the error message for a single error, regardless of whether
 * or not it has an associated format.
 * @param {!amp.validator.ValidationError} error
 * @return {!string}
 * @export
 */
amp.validator.renderErrorMessage = function(error) {
  let out = '';
  const format =
      parsedValidatorRulesSingleton.getFormatByCode().get(error.code);
  // A11Y errors are special cased and don't have parameters.
  if (format !== undefined && error.params.length > 0) {
    out += applyFormat(format, error);
  } else {
    out += error.code;
    if (error.detail !== undefined)
      out += ' ' + error.detail;
  }
  return out;
};

/**
 * Renders one line of error output.
 * @param {!string} filenameOrUrl
 * @param {!amp.validator.ValidationError} error
 * @return {!string}
 */
function errorLine(filenameOrUrl, error) {
  const line = error.line || 1;
  const col = error.col || 0;

  let errorLine = goog.uri.utils.removeFragment(filenameOrUrl) +
      ':' + line + ':' + col + ' ';
  errorLine += amp.validator.renderErrorMessage(error);
  if (error.specUrl) {
    errorLine += ' (see ' + error.specUrl + ')';
  }
  if (error.category !== null) {
    errorLine += ' [' + error.category + ']';
  }
  return errorLine;
}

/**
 * Renders the validation results into an array of human readable strings.
 * Careful when modifying this - it's called from
 * https://github.com/ampproject/amphtml/blob/master/test/integration/test-example-validation.js.
 * @param {!Object} validationResult
 * @param {string} filename to use in rendering error messages.
 * @return {!Array<string>}
 * @export
 */
amp.validator.renderValidationResult = function(validationResult, filename) {
  const rendered = [];
  rendered.push(validationResult.status);
  for (const error of validationResult.errors) {
    rendered.push(errorLine(filename, error));
  }
  return rendered;
};

/**
 * Computes the validation category for this |error|. This is a higher
 * level classification that distinguishes layout problems, problems
 * with specific tags, etc. The category is determined with heuristics,
 * just based on the information in |error|. We consider
 * ValidationError::Code, ValidationError::params (including suffix /
 * prefix matches.
 * @param {!amp.validator.ValidationError} error
 * @return {!amp.validator.ErrorCategory.Code}
 * @export
 */
amp.validator.categorizeError = function(error) {
  // This shouldn't happen in practice. We always set some params, and
  // UNKNOWN_CODE would indicate that the field wasn't populated.
  if (error.params.length === 0 ||
      error.code === amp.validator.ValidationError.Code.UNKNOWN_CODE ||
      error.code === null) {
    return amp.validator.ErrorCategory.Code.UNKNOWN;
  }
  // E.g. "The tag 'img' may only appear as a descendant of tag
  // 'noscript'. Did you mean 'amp-img'?"
  if (error.code === amp.validator.ValidationError.Code.DISALLOWED_TAG) {
    if (error.params[0] === "img" || error.params[0] === "video" ||
        error.params[0] === "audio" || error.params[0] === "iframe" ||
        error.params[0] === "font") {
      return amp.validator.ErrorCategory.Code.
          DISALLOWED_HTML_WITH_AMP_EQUIVALENT;
    }
    // E.g. "The tag 'picture' is disallowed."
    return amp.validator.ErrorCategory.Code.DISALLOWED_HTML;
  }
  // E.g. "tag 'img' may only appear as a descendant of tag
  // 'noscript'. Did you mean 'amp-img'?"
  if (error.code ===
      amp.validator.ValidationError.Code.MANDATORY_TAG_ANCESTOR_WITH_HINT) {
    return amp.validator.ErrorCategory.Code.DISALLOWED_HTML_WITH_AMP_EQUIVALENT;
  }
  // At the moment it's not possible to get this particular error since
  // all mandatory tag ancestors have hints except for noscript, but
  // usually when noscript fails then it reports an error for mandatory_parent
  // (since there is such a TagSpec as well, for the head).
  if (error.code ===
      amp.validator.ValidationError.Code.MANDATORY_TAG_ANCESTOR) {
    if (goog.string./*OK*/startsWith(error.params[0], "amp-")
        || goog.string./*OK*/startsWith(error.params[1], "amp-")) {
      return amp.validator.ErrorCategory.Code.AMP_TAG_PROBLEM;
    }
    return amp.validator.ErrorCategory.Code.DISALLOWED_HTML;
  }
  // E.g. "The text (CDATA) inside tag 'author stylesheet' matches
  // 'CSS !important', which is disallowed."
  if (error.code === amp.validator.ValidationError.Code.STYLESHEET_TOO_LONG ||
      (error.code ===
      amp.validator.ValidationError.Code.CDATA_VIOLATES_BLACKLIST
      && error.params[0] === "author stylesheet")) {
    return amp.validator.ErrorCategory.Code.AUTHOR_STYLESHEET_PROBLEM;
  }
  // E.g. "CSS syntax error in tag 'author stylesheet' - Invalid Declaration."
  // TODO(powdercloud): Legacy generic css error code. Remove after 2016-06-01.
  if (error.code === amp.validator.ValidationError.Code.CSS_SYNTAX &&
      error.params[0] === "author stylesheet") {
    return amp.validator.ErrorCategory.Code.AUTHOR_STYLESHEET_PROBLEM;
  }
  // E.g. "CSS syntax error in tag 'author stylesheet' - unterminated string."
  if ((error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_STRAY_TRAILING_BACKSLASH ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_UNTERMINATED_COMMENT ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_UNTERMINATED_STRING ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_BAD_URL ||
      error.code ===
      amp.validator.ValidationError.Code
      .CSS_SYNTAX_EOF_IN_PRELUDE_OF_QUALIFIED_RULE ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_INVALID_DECLARATION ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_INCOMPLETE_DECLARATION ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_INVALID_AT_RULE ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_ERROR_IN_PSEUDO_SELECTOR ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_MISSING_SELECTOR ||
      error.code ===
      amp.validator.ValidationError.Code.CSS_SYNTAX_NOT_A_SELECTOR_START ||
      error.code ===
      amp.validator.ValidationError.Code.
      CSS_SYNTAX_UNPARSED_INPUT_REMAINS_IN_SELECTOR) &&
      error.params[0] === "author stylesheet") {
    return amp.validator.ErrorCategory.Code.AUTHOR_STYLESHEET_PROBLEM;
  }
  // E.g. "The mandatory tag 'boilerplate (noscript)' is missing or
  // incorrect."
  if (error.code === amp.validator.ValidationError.Code.MANDATORY_TAG_MISSING ||
      (error.code ===
          amp.validator.ValidationError.Code.MANDATORY_ATTR_MISSING
          && error.params[0] === "⚡") ||
      (error.code === amp.validator.ValidationError.
          Code.MANDATORY_CDATA_MISSING_OR_INCORRECT
          && goog.string./*OK*/startsWith(error.params[0], "boilerplate"))) {
    return amp.validator.ErrorCategory.Code.
        MANDATORY_AMP_TAG_MISSING_OR_INCORRECT;
  }
  // E.g. "The mandatory tag 'meta name=viewport' is missing or
  // incorrect."
  if ((error.code ===
       amp.validator.ValidationError.Code.DISALLOWED_PROPERTY_IN_ATTR_VALUE ||
      error.code ===
      amp.validator.ValidationError.Code.INVALID_PROPERTY_VALUE_IN_ATTR_VALUE ||
      error.code ===
      amp.validator.ValidationError.Code.
      MANDATORY_PROPERTY_MISSING_FROM_ATTR_VALUE) &&
      error.params[2] === "meta name=viewport") {
    return amp.validator.ErrorCategory.Code.
        MANDATORY_AMP_TAG_MISSING_OR_INCORRECT;
  }
  // E.g. "The mandatory attribute 'height' is missing in tag 'amp-img'."
  if (error.code === amp.validator.ValidationError.Code.
      ATTR_VALUE_REQUIRED_BY_LAYOUT ||
      error.code === amp.validator.ValidationError.Code.
      IMPLIED_LAYOUT_INVALID ||
      error.code === amp.validator.ValidationError.Code.
      SPECIFIED_LAYOUT_INVALID ||
      (error.code === amp.validator.ValidationError.Code.
      INCONSISTENT_UNITS_FOR_WIDTH_AND_HEIGHT) ||
      ((error.code === amp.validator.ValidationError.Code.INVALID_ATTR_VALUE ||
        error.code === amp.validator.ValidationError.Code.
      MANDATORY_ATTR_MISSING) &&
      (error.params[0] === "width" || error.params[0] === "height" ||
      error.params[0] === "layout"))) {
    return amp.validator.ErrorCategory.Code.AMP_LAYOUT_PROBLEM;
  }
  if (error.code === amp.validator.ValidationError.Code.
      ATTR_DISALLOWED_BY_IMPLIED_LAYOUT ||
      error.code === amp.validator.ValidationError.Code.
      ATTR_DISALLOWED_BY_SPECIFIED_LAYOUT) {
    return amp.validator.ErrorCategory.Code.AMP_LAYOUT_PROBLEM;
  }
  // E..g. "The attribute 'src' in tag 'amphtml engine v0.js script'
  // is set to the invalid value
  // '//static.breakingnews.com/ads/gptLoader.js'."
  if (error.code === amp.validator.ValidationError.Code.INVALID_ATTR_VALUE
      && error.params[0] === "src"
      && goog.string./*OK*/endsWith(error.params[1], "script")) {
    return amp.validator.ErrorCategory.Code.CUSTOM_JAVASCRIPT_DISALLOWED;
  }
  // E.g.: "The attribute 'type' in tag 'script type=application/ld+json'
  // is set to the invalid value 'text/javascript'."
  if (error.code === amp.validator.ValidationError.Code.INVALID_ATTR_VALUE
      && goog.string./*OK*/startsWith(error.params[1], "script")
      && error.params[0] === "type") {
    return amp.validator.ErrorCategory.Code.CUSTOM_JAVASCRIPT_DISALLOWED;
  }
  // E.g. "The attribute 'srcset' may not appear in tag 'amp-audio >
  // source'."
  if ((error.code === amp.validator.ValidationError.Code.INVALID_ATTR_VALUE ||
      error.code === amp.validator.ValidationError.Code.DISALLOWED_ATTR ||
      error.code === amp.validator.ValidationError.Code.
      MANDATORY_ATTR_MISSING)) {
    if (goog.string./*OK*/startsWith(error.params[1], "amp-")) {
      return amp.validator.ErrorCategory.Code.AMP_TAG_PROBLEM;
    }
    // E.g. "The attribute 'async' may not appear in tag 'link
    // rel=stylesheet for fonts'."
    return amp.validator.ErrorCategory.Code.DISALLOWED_HTML;
  }
  // Like the previous example but the tag is params[0] here. This
  // error should always be for AMP elements thus far, so we don't
  // check for params[0].
  if (error.code === amp.validator.ValidationError.Code.
      MANDATORY_ONEOF_ATTR_MISSING) {
    return amp.validator.ErrorCategory.Code.AMP_TAG_PROBLEM;
  }
  // E.g. "The attribute 'shortcode' in tag 'amp-instagram' is deprecated -
  // use 'data-shortcode' instead."
  if (error.code === amp.validator.ValidationError.Code.DEPRECATED_ATTR
      || error.code === amp.validator.ValidationError.Code.DEPRECATED_TAG) {
    return amp.validator.ErrorCategory.Code.DEPRECATION;
  }
  // E.g. "The parent tag of tag 'source' is 'picture', but it can
  // only be 'amp-audio'."
  if (error.code === amp.validator.ValidationError.Code.WRONG_PARENT_TAG) {
    if (goog.string./*OK*/startsWith(error.params[0], "amp-")
        || goog.string./*OK*/startsWith(error.params[1], "amp-")
        || goog.string./*OK*/startsWith(error.params[2], "amp-")) {
      return amp.validator.ErrorCategory.Code.AMP_TAG_PROBLEM;
    }
    // E.g. "The parent tag of tag 'script' is 'body', but it can only
    // be 'head'".
    return amp.validator.ErrorCategory.Code.DISALLOWED_HTML;
  }
  // E.g. "The 'amp-image-lightbox extension .js script' tag is
  // missing or incorrect, but required by 'amp-image-lightbox'."
  if (error.code === amp.validator.ValidationError.Code.
      TAG_REQUIRED_BY_MISSING &&
      (goog.string./*OK*/startsWith(error.params[1], "amp-") ||
       error.params[1] === "template")) {
    return amp.validator.ErrorCategory.Code.AMP_TAG_PROBLEM;
  }
  // E.g. "Mutually exclusive attributes encountered in tag
  // 'amp-youtube' - pick one of ['src', 'data-videoid']."
  if (error.code === amp.validator.ValidationError.Code.
      MUTUALLY_EXCLUSIVE_ATTRS &&
      goog.string./*OK*/startsWith(error.params[0], "amp-")) {
    return amp.validator.ErrorCategory.Code.AMP_TAG_PROBLEM;
  }
  // E.g. "The tag 'boilerplate (noscript) - old variant' appears
  // more than once in the document."
  if (error.code === amp.validator.ValidationError.Code.
      DUPLICATE_UNIQUE_TAG) {
    return amp.validator.ErrorCategory.Code.
        MANDATORY_AMP_TAG_MISSING_OR_INCORRECT;
  }
  // E.g. "Mustache template syntax in attribute name
  // 'data-{{&notallowed}}' in tag 'p'."
  if (error.code === amp.validator.ValidationError.Code.
      UNESCAPED_TEMPLATE_IN_ATTR_VALUE ||
      error.code === amp.validator.ValidationError.Code.
      TEMPLATE_PARTIAL_IN_ATTR_VALUE ||
      error.code === amp.validator.ValidationError.Code.
      TEMPLATE_IN_ATTR_NAME) {
    return amp.validator.ErrorCategory.Code.AMP_MUSTACHE_TEMPLATE_PROBLEM;
  }
  if (error.code === amp.validator.ValidationError.Code
      .DISALLOWED_TAG_ANCESTOR &&
      (error.params[1] === "template")) {
    return amp.validator.ErrorCategory.Code.AMP_MUSTACHE_TEMPLATE_PROBLEM;
  }
  // E.g. "Missing URL for attribute 'href' in tag 'a'."
  // E.g. "Invalid URL protocol 'http:' for attribute 'src' in tag
  // 'amp-iframe'." Note: Parameters in the format strings appear out
  // of order so that error.params(1) is the tag for all three of these.
  if (error.code == amp.validator.ValidationError.Code.MISSING_URL ||
      error.code == amp.validator.ValidationError.Code.INVALID_URL ||
      error.code == amp.validator.ValidationError.Code.INVALID_URL_PROTOCOL) {
    if (goog.string./*OK*/startsWith(error.params[1], "amp-")) {
      return amp.validator.ErrorCategory.Code.AMP_TAG_PROBLEM;
    }
    return amp.validator.ErrorCategory.Code.DISALLOWED_HTML;
  }
  return amp.validator.ErrorCategory.Code.GENERIC;
};

/**
 * Convenience function which calls |CategorizeError| for each error
 * in |result| and sets its category field accordingly.
 * @param {!amp.validator.ValidationResult} result
 * @export
 */
amp.validator.annotateWithErrorCategories = function(result) {
  for (const error of result.errors) {
    error.category = amp.validator.categorizeError(error);
  }
};
