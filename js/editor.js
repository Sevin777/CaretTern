/* jshint laxcomma:false, unused:true, laxbreak:false, maxerr:10000 */

define(["storage/file", "command", "settings!ace,user", "util/dom2"], function(File, command, Settings) {
    
    //#region Default
    
    //Module for loading the editor, adding window resizing and other events. Returns the editor straight from Ace.
    var userConfig = Settings.get("user");
    var aceConfig = Settings.get("ace");
    var editor = window.editor = ace.edit("editor");
    window.editor = editor; //for debugging
    var themes = document.querySelector(".theme");
    
    //disable focusing on the editor except by program
    document.find("textarea").setAttribute("tabindex", - 1);
    
    //one-time startup
    var init = function() {
        aceConfig.themes.forEach(function(theme) {
            var option = document.createElement("option");
            option.innerHTML = theme.label;
            option.setAttribute("value", theme.name);
            themes.append(option);
        });
        reset();
        //let main.js know this module is ready
        return "editor";
    };
    
    //reloaded when settings change
    var reset = function() {
        userConfig = Settings.get("user");
        themes.value = userConfig.defaultTheme;
        editor.setTheme("ace/theme/" + themes.value);
        editor.setOptions({
            scrollPastEnd: userConfig.scrollPastEnd,
            showGutter: !userConfig.hideGutter
        });
        editor.setShowPrintMargin(userConfig.showMargin || false);
        editor.setPrintMarginColumn(userConfig.wrapLimit || 80);
        editor.setShowInvisibles(userConfig.showWhitespace || false);
        editor.setHighlightActiveLine(userConfig.highlightLine || false);
        editor.container.style.fontFamily = userConfig.fontFamily || null;
        defaultFontSize();
        //load tern
        ace.config.loadModule('ace/ext/language_tools', function() {
            ace.config.loadModule('ace/ext/tern', function() {
                editor.setOptions({
                    enableTern: userConfig.autocomplete,
                    ternLocalStringMinLength: 3,
                    enableSnippets: userConfig.autocomplete,
                    enableBasicAutocompletion: userConfig.autocomplete
                });
                //TODO- make tern read this from a config file per project
                try {
                    if (editor.ternServer) {
                        editor.ternServer.options.plugins.requirejs = userConfig.ternRequireJS;
                        editor.ternServer.options.plugins.angular = true;
                        //tell it how to get files for requirejs
                        editor.ternServer.options.getFile = function(name, callback) {
                            require(["ui/projectManager"], function(projectManager) {
                                projectManager.readFile(name, function(err,data){
                                    callback(err,data);
                                });
                            });
                        };
                        //tell it how to switch to another file
                        editor.ternServer.options.switchToDoc = function(name, start, end) {
                            require(["ui/projectManager"], function(projectManager) {
                                log('open project file name: ' + name);
                                projectManager.openFile(name);
                                //GHETTO: hopefully the file is open by now, so lets jump to the start location (need to update project manager openFile to accept callback when its done to trigger this)
                                setTimeout(function() {
                                    editor.gotoLine(start.row, start.column || 0); //this will make sure that the line is expanded
                                    var sel = editor.getSession().getSelection(); // sel.selectionLead.setPosistion();// sel.selectionAnchor.setPosistion();
                                    sel.setSelectionRange({
                                        start: start,
                                        end: end
                                    });
                                }, 250);
                                // console.log('need to add a way to make this jump to start location after switching file. start='+start);
                            });
                        };
                        editor.ternServer.restart();
                    }
                }
                catch (ex) {
                    alert('error setting ternRequireJS: ' + ex.toString());
                }
            });
        });
    };
    
    //#endregion


    //#region Split
    //does not work yet
    /* ace.config.loadModule('ace/ext/split', function() {
        var Split = ace.require('ace/ext/split').Split;
        var split = new Split(editor.container,"chrome",1);
        editor = split.getEditor(0);
        split.on("focus", function(editor) {
            editor = editor;
        });
        window.split = split;
        split.setSplits(2);
    });*/
    //#endregion


    //#region Beautify
    var Range = ace.require("ace/range").Range;
    /**
     * Gets editors mode at cursor posistion (including nested mode) (copied from snipped manager)
     * @param {bool} [allowNestedMode=false] - pass true return nested mode if in mixed html mode
     */
    function getCurrentMode(editor, allowNestedMode) {
        var scope = editor.session.$mode.$id || "";
        scope = scope.split("/").pop();
        if (scope === "html" || scope === "php") {
            if (scope === "php") scope = "html";
            var c = editor.getCursorPosition();
            var state = editor.session.getState(c.row);
            if (typeof state === "object") {
                state = state[0];
            }
            if (allowNestedMode) {
                if (state.substring) {
                    if (state.substring(0, 3) == "js-") scope = "javascript";
                    else if (state.substring(0, 4) == "css-") scope = "css";
                    else if (state.substring(0, 4) == "php-") scope = "php";
                }
            }
        }
        return scope;
    }
    //quick and ghetto
    var jsbeautify = {
        js_beautify: function(js_source_text, options) {
            var input, output, token_text, last_type, last_text, last_last_text, last_word, flags, flag_store, indent_string;
            var whitespace, wordchar, punct, parser_pos, line_starters, digits;
            var prefix, token_type, do_block_just_closed;
            var wanted_newline, just_added_newline, n_newlines;
            var preindent_string = '';
            // Some interpreters have unexpected results with foo = baz || bar;
            options = options ? options : {};
            var opt_brace_style;
            // compatibility
            if (options.space_after_anon_function !== undefined && options.jslint_happy === undefined) {
                options.jslint_happy = options.space_after_anon_function;
            }
            if (options.braces_on_own_line !== undefined) { //graceful handling of deprecated option
                opt_brace_style = options.braces_on_own_line ? "expand" : "collapse";
            }
            opt_brace_style = options.brace_style ? options.brace_style : (opt_brace_style ? opt_brace_style : "collapse");
            var opt_indent_size = options.indent_size ? options.indent_size : 4;
            var opt_indent_char = options.indent_char ? options.indent_char : ' ';
            var opt_preserve_newlines = typeof options.preserve_newlines === 'undefined' ? true : options.preserve_newlines;
            var opt_max_preserve_newlines = typeof options.max_preserve_newlines === 'undefined' ? false : options.max_preserve_newlines;
            var opt_jslint_happy = options.jslint_happy === 'undefined' ? false : options.jslint_happy;
            var opt_keep_array_indentation = typeof options.keep_array_indentation === 'undefined' ? false : options.keep_array_indentation;
            var opt_space_before_conditional = typeof options.space_before_conditional === 'undefined' ? true : options.space_before_conditional;
            var opt_indent_case = typeof options.indent_case === 'undefined' ? false : options.indent_case;
            var opt_unescape_strings = typeof options.unescape_strings === 'undefined' ? false : options.unescape_strings;
            just_added_newline = false;
            // cache the source's length.
            var input_length = js_source_text.length;

            function trim_output(eat_newlines) {
                eat_newlines = typeof eat_newlines === 'undefined' ? false : eat_newlines;
                while (output.length && (output[output.length - 1] === ' ' || output[output.length - 1] === indent_string || output[output.length - 1] === preindent_string || (eat_newlines && (output[output.length - 1] === '\n' || output[output.length - 1] === '\r')))) {
                    output.pop();
                }
            }

            function trim(s) {
                return s.replace(/^\s\s*|\s\s*$/, '');
            }
            // we could use just string.split, but
            // IE doesn't like returning empty strings
            function split_newlines(s) {
                //return s.split(/\x0d\x0a|\x0a/);
                s = s.replace(/\x0d/g, '');
                var out = [],
                    idx = s.indexOf("\n");
                while (idx !== -1) {
                    out.push(s.substring(0, idx));
                    s = s.substring(idx + 1);
                    idx = s.indexOf("\n");
                }
                if (s.length) {
                    out.push(s);
                }
                return out;
            }

            function force_newline() {
                var old_keep_array_indentation = opt_keep_array_indentation;
                opt_keep_array_indentation = false;
                print_newline();
                opt_keep_array_indentation = old_keep_array_indentation;
            }

            function print_newline(ignore_repeated) {
                flags.eat_next_space = false;
                if (opt_keep_array_indentation && is_array(flags.mode)) {
                    return;
                }
                ignore_repeated = typeof ignore_repeated === 'undefined' ? true : ignore_repeated;
                flags.if_line = false;
                trim_output();
                if (!output.length) {
                    return; // no newline on start of file
                }
                if (output[output.length - 1] !== "\n" || !ignore_repeated) {
                    just_added_newline = true;
                    output.push("\n");
                }
                if (preindent_string) {
                    output.push(preindent_string);
                }
                for (var i = 0; i < flags.indentation_level; i += 1) {
                    output.push(indent_string);
                }
                if (flags.var_line && flags.var_line_reindented) {
                    output.push(indent_string); // skip space-stuffing, if indenting with a tab
                }
                if (flags.case_body) {
                    output.push(indent_string);
                }
            }

            function print_single_space() {
                if (last_type === 'TK_COMMENT') {
                    return print_newline();
                }
                if (flags.eat_next_space) {
                    flags.eat_next_space = false;
                    return;
                }
                var last_output = ' ';
                if (output.length) {
                    last_output = output[output.length - 1];
                }
                if (last_output !== ' ' && last_output !== '\n' && last_output !== indent_string) { // prevent occassional duplicate space
                    output.push(' ');
                }
            }

            function print_token() {
                just_added_newline = false;
                flags.eat_next_space = false;
                output.push(token_text);
            }

            function indent() {
                flags.indentation_level += 1;
            }

            function remove_indent() {
                if (output.length && output[output.length - 1] === indent_string) {
                    output.pop();
                }
            }

            function set_mode(mode) {
                if (flags) {
                    flag_store.push(flags);
                }
                flags = {
                    previous_mode: flags ? flags.mode : 'BLOCK',
                    mode: mode,
                    var_line: false,
                    var_line_tainted: false,
                    var_line_reindented: false,
                    in_html_comment: false,
                    if_line: false,
                    in_case_statement: false, // switch(..){ INSIDE HERE }
                    in_case: false, // we're on the exact line with "case 0:"
                    case_body: false, // the indented case-action block
                    eat_next_space: false,
                    indentation_baseline: -1,
                    indentation_level: (flags ? flags.indentation_level + (flags.case_body ? 1 : 0) + ((flags.var_line && flags.var_line_reindented) ? 1 : 0) : 0),
                    ternary_depth: 0
                };
            }

            function is_array(mode) {
                return mode === '[EXPRESSION]' || mode === '[INDENTED-EXPRESSION]';
            }

            function is_expression(mode) {
                return in_array(mode, ['[EXPRESSION]', '(EXPRESSION)', '(FOR-EXPRESSION)', '(COND-EXPRESSION)']);
            }

            function restore_mode() {
                do_block_just_closed = flags.mode === 'DO_BLOCK';
                if (flag_store.length > 0) {
                    var mode = flags.mode;
                    flags = flag_store.pop();
                    flags.previous_mode = mode;
                }
            }

            function all_lines_start_with(lines, c) {
                for (var i = 0; i < lines.length; i++) {
                    var line = trim(lines[i]);
                    if (line.charAt(0) !== c) {
                        return false;
                    }
                }
                return true;
            }

            function is_special_word(word) {
                return in_array(word, ['case', 'return', 'do', 'if', 'throw', 'else']);
            }

            function in_array(what, arr) {
                for (var i = 0; i < arr.length; i += 1) {
                    if (arr[i] === what) {
                        return true;
                    }
                }
                return false;
            }

            function look_up(exclude) {
                var local_pos = parser_pos;
                var c = input.charAt(local_pos);
                while (in_array(c, whitespace) && c !== exclude) {
                    local_pos++;
                    if (local_pos >= input_length) {
                        return 0;
                    }
                    c = input.charAt(local_pos);
                }
                return c;
            }

            function get_next_token() {
                var i;
                var resulting_string;
                n_newlines = 0;
                if (parser_pos >= input_length) {
                    return ['', 'TK_EOF'];
                }
                wanted_newline = false;
                var c = input.charAt(parser_pos);
                parser_pos += 1;
                var keep_whitespace = opt_keep_array_indentation && is_array(flags.mode);
                if (keep_whitespace) {
                    //
                    // slight mess to allow nice preservation of array indentation and reindent that correctly
                    // first time when we get to the arrays:
                    // var a = [
                    // ....'something'
                    // we make note of whitespace_count = 4 into flags.indentation_baseline
                    // so we know that 4 whitespaces in original source match indent_level of reindented source
                    //
                    // and afterwards, when we get to
                    //    'something,
                    // .......'something else'
                    // we know that this should be indented to indent_level + (7 - indentation_baseline) spaces
                    //
                    var whitespace_count = 0;
                    while (in_array(c, whitespace)) {
                        if (c === "\n") {
                            trim_output();
                            output.push("\n");
                            just_added_newline = true;
                            whitespace_count = 0;
                        }
                        else {
                            if (c === '\t') {
                                whitespace_count += 4;
                            }
                            else if (c === '\r') {
                                // nothing
                            }
                            else {
                                whitespace_count += 1;
                            }
                        }
                        if (parser_pos >= input_length) {
                            return ['', 'TK_EOF'];
                        }
                        c = input.charAt(parser_pos);
                        parser_pos += 1;
                    }
                    if (flags.indentation_baseline === -1) {
                        flags.indentation_baseline = whitespace_count;
                    }
                    if (just_added_newline) {
                        for (i = 0; i < flags.indentation_level + 1; i += 1) {
                            output.push(indent_string);
                        }
                        if (flags.indentation_baseline !== -1) {
                            for (i = 0; i < whitespace_count - flags.indentation_baseline; i++) {
                                output.push(' ');
                            }
                        }
                    }
                }
                else {
                    while (in_array(c, whitespace)) {
                        if (c === "\n") {
                            n_newlines += ((opt_max_preserve_newlines) ? (n_newlines <= opt_max_preserve_newlines) ? 1 : 0 : 1);
                        }
                        if (parser_pos >= input_length) {
                            return ['', 'TK_EOF'];
                        }
                        c = input.charAt(parser_pos);
                        parser_pos += 1;
                    }
                    if (opt_preserve_newlines) {
                        if (n_newlines > 1) {
                            for (i = 0; i < n_newlines; i += 1) {
                                print_newline(i === 0);
                                just_added_newline = true;
                            }
                        }
                    }
                    wanted_newline = n_newlines > 0;
                }
                if (in_array(c, wordchar)) {
                    if (parser_pos < input_length) {
                        while (in_array(input.charAt(parser_pos), wordchar)) {
                            c += input.charAt(parser_pos);
                            parser_pos += 1;
                            if (parser_pos === input_length) {
                                break;
                            }
                        }
                    }
                    // small and surprisingly unugly hack for 1E-10 representation
                    if (parser_pos !== input_length && c.match(/^[0-9]+[Ee]$/) && (input.charAt(parser_pos) === '-' || input.charAt(parser_pos) === '+')) {
                        var sign = input.charAt(parser_pos);
                        parser_pos += 1;
                        var t = get_next_token();
                        c += sign + t[0];
                        return [c, 'TK_WORD'];
                    }
                    if (c === 'in') { // hack for 'in' operator
                        return [c, 'TK_OPERATOR'];
                    }
                    if (wanted_newline && last_type !== 'TK_OPERATOR' && last_type !== 'TK_EQUALS' && !flags.if_line && (opt_preserve_newlines || last_text !== 'var')) {
                        print_newline();
                    }
                    return [c, 'TK_WORD'];
                }
                if (c === '(' || c === '[') {
                    return [c, 'TK_START_EXPR'];
                }
                if (c === ')' || c === ']') {
                    return [c, 'TK_END_EXPR'];
                }
                if (c === '{') {
                    return [c, 'TK_START_BLOCK'];
                }
                if (c === '}') {
                    return [c, 'TK_END_BLOCK'];
                }
                if (c === ';') {
                    return [c, 'TK_SEMICOLON'];
                }
                if (c === '/') {
                    var comment = '';
                    // peek for comment /* ... */
                    var inline_comment = true;
                    if (input.charAt(parser_pos) === '*') {
                        parser_pos += 1;
                        if (parser_pos < input_length) {
                            while (parser_pos < input_length && !(input.charAt(parser_pos) === '*' && input.charAt(parser_pos + 1) && input.charAt(parser_pos + 1) === '/')) {
                                c = input.charAt(parser_pos);
                                comment += c;
                                if (c === "\n" || c === "\r") {
                                    inline_comment = false;
                                }
                                parser_pos += 1;
                                if (parser_pos >= input_length) {
                                    break;
                                }
                            }
                        }
                        parser_pos += 2;
                        if (inline_comment && n_newlines === 0) {
                            return ['/*' + comment + '*/', 'TK_INLINE_COMMENT'];
                        }
                        else {
                            return ['/*' + comment + '*/', 'TK_BLOCK_COMMENT'];
                        }
                    }
                    // peek for comment // ...
                    if (input.charAt(parser_pos) === '/') {
                        comment = c;
                        while (input.charAt(parser_pos) !== '\r' && input.charAt(parser_pos) !== '\n') {
                            comment += input.charAt(parser_pos);
                            parser_pos += 1;
                            if (parser_pos >= input_length) {
                                break;
                            }
                        }
                        if (wanted_newline) {
                            print_newline();
                        }
                        return [comment, 'TK_COMMENT'];
                    }
                }
                if (c === "'" || // string
                c === '"' || // string
                (c === '/' && ((last_type === 'TK_WORD' && is_special_word(last_text)) || (last_text === ')' && in_array(flags.previous_mode, ['(COND-EXPRESSION)', '(FOR-EXPRESSION)'])) || (last_type === 'TK_COMMA' || last_type === 'TK_COMMENT' || last_type === 'TK_START_EXPR' || last_type === 'TK_START_BLOCK' || last_type === 'TK_END_BLOCK' || last_type === 'TK_OPERATOR' || last_type === 'TK_EQUALS' || last_type === 'TK_EOF' || last_type === 'TK_SEMICOLON')))) { // regexp
                    var sep = c;
                    var esc = false;
                    var esc1 = 0;
                    var esc2 = 0;
                    resulting_string = c;
                    if (parser_pos < input_length) {
                        if (sep === '/') {
                            //
                            // handle regexp separately...
                            //
                            var in_char_class = false;
                            while (esc || in_char_class || input.charAt(parser_pos) !== sep) {
                                resulting_string += input.charAt(parser_pos);
                                if (!esc) {
                                    esc = input.charAt(parser_pos) === '\\';
                                    if (input.charAt(parser_pos) === '[') {
                                        in_char_class = true;
                                    }
                                    else if (input.charAt(parser_pos) === ']') {
                                        in_char_class = false;
                                    }
                                }
                                else {
                                    esc = false;
                                }
                                parser_pos += 1;
                                if (parser_pos >= input_length) {
                                    // incomplete string/rexp when end-of-file reached.
                                    // bail out with what had been received so far.
                                    return [resulting_string, 'TK_STRING'];
                                }
                            }
                        }
                        else {
                            //
                            // and handle string also separately
                            //
                            while (esc || input.charAt(parser_pos) !== sep) {
                                resulting_string += input.charAt(parser_pos);
                                if (esc1 && esc1 >= esc2) {
                                    esc1 = parseInt(resulting_string.substr(-esc2), 16);
                                    if (esc1 && esc1 >= 0x20 && esc1 <= 0x7e) {
                                        esc1 = String.fromCharCode(esc1);
                                        resulting_string = resulting_string.substr(0, resulting_string.length - esc2 - 2) + (((esc1 === sep) || (esc1 === '\\')) ? '\\' : '') + esc1;
                                    }
                                    esc1 = 0;
                                }
                                if (esc1) {
                                    esc1++;
                                }
                                else if (!esc) {
                                    esc = input.charAt(parser_pos) === '\\';
                                }
                                else {
                                    esc = false;
                                    if (opt_unescape_strings) {
                                        if (input.charAt(parser_pos) === 'x') {
                                            esc1++;
                                            esc2 = 2;
                                        }
                                        else if (input.charAt(parser_pos) === 'u') {
                                            esc1++;
                                            esc2 = 4;
                                        }
                                    }
                                }
                                parser_pos += 1;
                                if (parser_pos >= input_length) {
                                    // incomplete string/rexp when end-of-file reached.
                                    // bail out with what had been received so far.
                                    return [resulting_string, 'TK_STRING'];
                                }
                            }
                        }
                    }
                    parser_pos += 1;
                    resulting_string += sep;
                    if (sep === '/') {
                        // regexps may have modifiers /regexp/MOD , so fetch those, too
                        while (parser_pos < input_length && in_array(input.charAt(parser_pos), wordchar)) {
                            resulting_string += input.charAt(parser_pos);
                            parser_pos += 1;
                        }
                    }
                    return [resulting_string, 'TK_STRING'];
                }
                if (c === '#') {
                    if (output.length === 0 && input.charAt(parser_pos) === '!') {
                        // shebang
                        resulting_string = c;
                        while (parser_pos < input_length && c !== '\n') {
                            c = input.charAt(parser_pos);
                            resulting_string += c;
                            parser_pos += 1;
                        }
                        output.push(trim(resulting_string) + '\n');
                        print_newline();
                        return get_next_token();
                    }
                    // Spidermonkey-specific sharp variables for circular references
                    // https://developer.mozilla.org/En/Sharp_variables_in_JavaScript
                    // http://mxr.mozilla.org/mozilla-central/source/js/src/jsscan.cpp around line 1935
                    var sharp = '#';
                    if (parser_pos < input_length && in_array(input.charAt(parser_pos), digits)) {
                        do {
                            c = input.charAt(parser_pos);
                            sharp += c;
                            parser_pos += 1;
                        } while (parser_pos < input_length && c !== '#' && c !== '=');
                        if (c === '#') {
                            //
                        }
                        else if (input.charAt(parser_pos) === '[' && input.charAt(parser_pos + 1) === ']') {
                            sharp += '[]';
                            parser_pos += 2;
                        }
                        else if (input.charAt(parser_pos) === '{' && input.charAt(parser_pos + 1) === '}') {
                            sharp += '{}';
                            parser_pos += 2;
                        }
                        return [sharp, 'TK_WORD'];
                    }
                }
                if (c === '<' && input.substring(parser_pos - 1, parser_pos + 3) === '<!--') {
                    parser_pos += 3;
                    c = '<!--';
                    while (input.charAt(parser_pos) !== '\n' && parser_pos < input_length) {
                        c += input.charAt(parser_pos);
                        parser_pos++;
                    }
                    flags.in_html_comment = true;
                    return [c, 'TK_COMMENT'];
                }
                if (c === '-' && flags.in_html_comment && input.substring(parser_pos - 1, parser_pos + 2) === '-->') {
                    flags.in_html_comment = false;
                    parser_pos += 2;
                    if (wanted_newline) {
                        print_newline();
                    }
                    return ['-->', 'TK_COMMENT'];
                }
                if (in_array(c, punct)) {
                    while (parser_pos < input_length && in_array(c + input.charAt(parser_pos), punct)) {
                        c += input.charAt(parser_pos);
                        parser_pos += 1;
                        if (parser_pos >= input_length) {
                            break;
                        }
                    }
                    if (c === ',') {
                        return [c, 'TK_COMMA'];
                    }
                    else if (c === '=') {
                        return [c, 'TK_EQUALS'];
                    }
                    else {
                        return [c, 'TK_OPERATOR'];
                    }
                }
                return [c, 'TK_UNKNOWN'];
            }
            //----------------------------------
            indent_string = '';
            while (opt_indent_size > 0) {
                indent_string += opt_indent_char;
                opt_indent_size -= 1;
            }
            while (js_source_text && (js_source_text.charAt(0) === ' ' || js_source_text.charAt(0) === '\t')) {
                preindent_string += js_source_text.charAt(0);
                js_source_text = js_source_text.substring(1);
            }
            input = js_source_text;
            last_word = ''; // last 'TK_WORD' passed
            last_type = 'TK_START_EXPR'; // last token type
            last_text = ''; // last token text
            last_last_text = ''; // pre-last token text
            output = [];
            do_block_just_closed = false;
            whitespace = "\n\r\t ".split('');
            wordchar = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$'.split('');
            digits = '0123456789'.split('');
            punct = '+ - * / % & ++ -- = += -= *= /= %= == === != !== > < >= <= >> << >>> >>>= >>= <<= && &= | || ! !! , : ? ^ ^= |= ::';
            punct += ' <%= <% %> <?= <? ?>'; // try to be a good boy and try not to break the markup language identifiers
            punct = punct.split(' ');
            // words which should always start on new line.
            line_starters = 'continue,try,throw,return,var,if,switch,case,default,for,while,break,function'.split(',');
            // states showing if we are currently in expression (i.e. "if" case) - 'EXPRESSION', or in usual block (like, procedure), 'BLOCK'.
            // some formatting depends on that.
            flag_store = [];
            set_mode('BLOCK');
            parser_pos = 0;
            while (true) {
                var t = get_next_token();
                token_text = t[0];
                token_type = t[1];
                if (token_type === 'TK_EOF') {
                    break;
                }
                switch (token_type) {
                case 'TK_START_EXPR':
                    if (token_text === '[') {
                        if (last_type === 'TK_WORD' || last_text === ')') {
                            // this is array index specifier, break immediately
                            // a[x], fn()[x]
                            if (in_array(last_text, line_starters)) {
                                print_single_space();
                            }
                            set_mode('(EXPRESSION)');
                            print_token();
                            break;
                        }
                        if (flags.mode === '[EXPRESSION]' || flags.mode === '[INDENTED-EXPRESSION]') {
                            if (last_last_text === ']' && last_text === ',') {
                                // ], [ goes to new line
                                if (flags.mode === '[EXPRESSION]') {
                                    flags.mode = '[INDENTED-EXPRESSION]';
                                    if (!opt_keep_array_indentation) {
                                        indent();
                                    }
                                }
                                set_mode('[EXPRESSION]');
                                if (!opt_keep_array_indentation) {
                                    print_newline();
                                }
                            }
                            else if (last_text === '[') {
                                if (flags.mode === '[EXPRESSION]') {
                                    flags.mode = '[INDENTED-EXPRESSION]';
                                    if (!opt_keep_array_indentation) {
                                        indent();
                                    }
                                }
                                set_mode('[EXPRESSION]');
                                if (!opt_keep_array_indentation) {
                                    print_newline();
                                }
                            }
                            else {
                                set_mode('[EXPRESSION]');
                            }
                        }
                        else {
                            set_mode('[EXPRESSION]');
                        }
                    }
                    else {
                        if (last_word === 'for') {
                            set_mode('(FOR-EXPRESSION)');
                        }
                        else if (in_array(last_word, ['if', 'while'])) {
                            set_mode('(COND-EXPRESSION)');
                        }
                        else {
                            set_mode('(EXPRESSION)');
                        }
                    }
                    if (last_text === ';' || last_type === 'TK_START_BLOCK') {
                        print_newline();
                    }
                    else if (last_type === 'TK_END_EXPR' || last_type === 'TK_START_EXPR' || last_type === 'TK_END_BLOCK' || last_text === '.') {
                        if (wanted_newline) {
                            print_newline();
                        }
                        // do nothing on (( and )( and ][ and ]( and .(
                    }
                    else if (last_type !== 'TK_WORD' && last_type !== 'TK_OPERATOR') {
                        print_single_space();
                    }
                    else if (last_word === 'function' || last_word === 'typeof') {
                        // function() vs function ()
                        if (opt_jslint_happy) {
                            print_single_space();
                        }
                    }
                    else if (in_array(last_text, line_starters) || last_text === 'catch') {
                        if (opt_space_before_conditional) {
                            print_single_space();
                        }
                    }
                    print_token();
                    break;
                case 'TK_END_EXPR':
                    if (token_text === ']') {
                        if (opt_keep_array_indentation) {
                            if (last_text === '}') {
                                // trim_output();
                                // print_newline(true);
                                remove_indent();
                                print_token();
                                restore_mode();
                                break;
                            }
                        }
                        else {
                            if (flags.mode === '[INDENTED-EXPRESSION]') {
                                if (last_text === ']') {
                                    restore_mode();
                                    print_newline();
                                    print_token();
                                    break;
                                }
                            }
                        }
                    }
                    restore_mode();
                    print_token();
                    break;
                case 'TK_START_BLOCK':
                    if (last_word === 'do') {
                        set_mode('DO_BLOCK');
                    }
                    else {
                        set_mode('BLOCK');
                    }
                    if (opt_brace_style === "expand" || opt_brace_style === "expand-strict") {
                        var empty_braces = false;
                        if (opt_brace_style === "expand-strict") {
                            empty_braces = (look_up() === '}');
                            if (!empty_braces) {
                                print_newline(true);
                            }
                        }
                        else {
                            if (last_type !== 'TK_OPERATOR') {
                                if (last_text === '=' || (is_special_word(last_text) && last_text !== 'else')) {
                                    print_single_space();
                                }
                                else {
                                    print_newline(true);
                                }
                            }
                        }
                        print_token();
                        if (!empty_braces) {
                            indent();
                        }
                    }
                    else {
                        if (last_type !== 'TK_OPERATOR' && last_type !== 'TK_START_EXPR') {
                            if (last_type === 'TK_START_BLOCK') {
                                print_newline();
                            }
                            else {
                                print_single_space();
                            }
                        }
                        else {
                            // if TK_OPERATOR or TK_START_EXPR
                            if (is_array(flags.previous_mode) && last_text === ',') {
                                if (last_last_text === '}') {
                                    // }, { in array context
                                    print_single_space();
                                }
                                else {
                                    print_newline(); // [a, b, c, {
                                }
                            }
                        }
                        indent();
                        print_token();
                    }
                    break;
                case 'TK_END_BLOCK':
                    restore_mode();
                    if (opt_brace_style === "expand" || opt_brace_style === "expand-strict") {
                        if (last_text !== '{') {
                            print_newline();
                        }
                        print_token();
                    }
                    else {
                        if (last_type === 'TK_START_BLOCK') {
                            // nothing
                            if (just_added_newline) {
                                remove_indent();
                            }
                            else {
                                // {}
                                trim_output();
                            }
                        }
                        else {
                            if (is_array(flags.mode) && opt_keep_array_indentation) {
                                // we REALLY need a newline here, but newliner would skip that
                                opt_keep_array_indentation = false;
                                print_newline();
                                opt_keep_array_indentation = true;
                            }
                            else {
                                print_newline();
                            }
                        }
                        print_token();
                    }
                    break;
                case 'TK_WORD':
                    // no, it's not you. even I have problems understanding how this works
                    // and what does what.
                    if (do_block_just_closed) {
                        // do {} ## while ()
                        print_single_space();
                        print_token();
                        print_single_space();
                        do_block_just_closed = false;
                        break;
                    }
                    prefix = 'NONE';
                    if (token_text === 'function') {
                        if (flags.var_line && last_type !== 'TK_EQUALS') {
                            flags.var_line_reindented = true;
                        }
                        if ((just_added_newline || last_text === ';') && last_text !== '{' && last_type !== 'TK_BLOCK_COMMENT' && last_type !== 'TK_COMMENT') {
                            // make sure there is a nice clean space of at least one blank line
                            // before a new function definition
                            n_newlines = just_added_newline ? n_newlines : 0;
                            if (!opt_preserve_newlines) {
                                n_newlines = 1;
                            }
                            for (var i = 0; i < 2 - n_newlines; i++) {
                                print_newline(false);
                            }
                        }
                        if (last_type === 'TK_WORD') {
                            if (last_text === 'get' || last_text === 'set' || last_text === 'new' || last_text === 'return') {
                                print_single_space();
                            }
                            else {
                                print_newline();
                            }
                        }
                        else if (last_type === 'TK_OPERATOR' || last_text === '=') {
                            // foo = function
                            print_single_space();
                        }
                        else if (is_expression(flags.mode)) {
                            //�� print nothing
                        }
                        else {
                            print_newline();
                        }
                        print_token();
                        last_word = token_text;
                        break;
                    }
                    if (token_text === 'case' || (token_text === 'default' && flags.in_case_statement)) {
                        if (last_text === ':' || flags.case_body) {
                            // switch cases following one another
                            remove_indent();
                        }
                        else {
                            // case statement starts in the same line where switch
                            if (!opt_indent_case) {
                                flags.indentation_level--;
                            }
                            print_newline();
                            if (!opt_indent_case) {
                                flags.indentation_level++;
                            }
                        }
                        print_token();
                        flags.in_case = true;
                        flags.in_case_statement = true;
                        flags.case_body = false;
                        break;
                    }
                    if (last_type === 'TK_END_BLOCK') {
                        if (!in_array(token_text.toLowerCase(), ['else', 'catch', 'finally'])) {
                            prefix = 'NEWLINE';
                        }
                        else {
                            if (opt_brace_style === "expand" || opt_brace_style === "end-expand" || opt_brace_style === "expand-strict") {
                                prefix = 'NEWLINE';
                            }
                            else {
                                prefix = 'SPACE';
                                print_single_space();
                            }
                        }
                    }
                    else if (last_type === 'TK_SEMICOLON' && (flags.mode === 'BLOCK' || flags.mode === 'DO_BLOCK')) {
                        prefix = 'NEWLINE';
                    }
                    else if (last_type === 'TK_SEMICOLON' && is_expression(flags.mode)) {
                        prefix = 'SPACE';
                    }
                    else if (last_type === 'TK_STRING') {
                        prefix = 'NEWLINE';
                    }
                    else if (last_type === 'TK_WORD') {
                        if (last_text === 'else') {
                            // eat newlines between ...else *** some_op...
                            // won't preserve extra newlines in this place (if any), but don't care that much
                            trim_output(true);
                        }
                        prefix = 'SPACE';
                    }
                    else if (last_type === 'TK_START_BLOCK') {
                        prefix = 'NEWLINE';
                    }
                    else if (last_type === 'TK_END_EXPR') {
                        print_single_space();
                        prefix = 'NEWLINE';
                    }
                    if (in_array(token_text, line_starters) && last_text !== ')') {
                        if (last_text === 'else') {
                            prefix = 'SPACE';
                        }
                        else {
                            prefix = 'NEWLINE';
                        }
                    }
                    if (flags.if_line && last_type === 'TK_END_EXPR') {
                        flags.if_line = false;
                    }
                    if (in_array(token_text.toLowerCase(), ['else', 'catch', 'finally'])) {
                        if (last_type !== 'TK_END_BLOCK' || opt_brace_style === "expand" || opt_brace_style === "end-expand" || opt_brace_style === "expand-strict") {
                            print_newline();
                        }
                        else {
                            trim_output(true);
                            print_single_space();
                        }
                    }
                    else if (prefix === 'NEWLINE') {
                        if (is_special_word(last_text)) {
                            // no newline between 'return nnn'
                            print_single_space();
                        }
                        else if (last_type !== 'TK_END_EXPR') {
                            if ((last_type !== 'TK_START_EXPR' || token_text !== 'var') && last_text !== ':') {
                                // no need to force newline on 'var': for (var x = 0...)
                                if (token_text === 'if' && last_word === 'else' && last_text !== '{') {
                                    // no newline for } else if {
                                    print_single_space();
                                }
                                else {
                                    flags.var_line = false;
                                    flags.var_line_reindented = false;
                                    print_newline();
                                }
                            }
                        }
                        else if (in_array(token_text, line_starters) && last_text !== ')') {
                            flags.var_line = false;
                            flags.var_line_reindented = false;
                            print_newline();
                        }
                    }
                    else if (is_array(flags.mode) && last_text === ',' && last_last_text === '}') {
                        print_newline(); // }, in lists get a newline treatment
                    }
                    else if (prefix === 'SPACE') {
                        print_single_space();
                    }
                    print_token();
                    last_word = token_text;
                    if (token_text === 'var') {
                        flags.var_line = true;
                        flags.var_line_reindented = false;
                        flags.var_line_tainted = false;
                    }
                    if (token_text === 'if') {
                        flags.if_line = true;
                    }
                    if (token_text === 'else') {
                        flags.if_line = false;
                    }
                    break;
                case 'TK_SEMICOLON':
                    print_token();
                    flags.var_line = false;
                    flags.var_line_reindented = false;
                    if (flags.mode === 'OBJECT') {
                        // OBJECT mode is weird and doesn't get reset too well.
                        flags.mode = 'BLOCK';
                    }
                    break;
                case 'TK_STRING':
                    if (last_type === 'TK_END_EXPR' && in_array(flags.previous_mode, ['(COND-EXPRESSION)', '(FOR-EXPRESSION)'])) {
                        print_single_space();
                    }
                    else if (last_type === 'TK_COMMENT' || last_type === 'TK_STRING' || last_type === 'TK_START_BLOCK' || last_type === 'TK_END_BLOCK' || last_type === 'TK_SEMICOLON') {
                        print_newline();
                    }
                    else if (last_type === 'TK_WORD') {
                        print_single_space();
                    }
                    print_token();
                    break;
                case 'TK_EQUALS':
                    if (flags.var_line) {
                        // just got an '=' in a var-line, different formatting/line-breaking, etc will now be done
                        flags.var_line_tainted = true;
                    }
                    print_single_space();
                    print_token();
                    print_single_space();
                    break;
                case 'TK_COMMA':
                    if (flags.var_line) {
                        if (is_expression(flags.mode) || last_type === 'TK_END_BLOCK') {
                            // do not break on comma, for(var a = 1, b = 2)
                            flags.var_line_tainted = false;
                        }
                        if (flags.var_line_tainted) {
                            print_token();
                            flags.var_line_reindented = true;
                            flags.var_line_tainted = false;
                            print_newline();
                            break;
                        }
                        else {
                            flags.var_line_tainted = false;
                        }
                        print_token();
                        print_single_space();
                        break;
                    }
                    if (last_type === 'TK_COMMENT') {
                        print_newline();
                    }
                    if (last_type === 'TK_END_BLOCK' && flags.mode !== "(EXPRESSION)") {
                        print_token();
                        if (flags.mode === 'OBJECT' && last_text === '}') {
                            print_newline();
                        }
                        else {
                            print_single_space();
                        }
                    }
                    else {
                        if (flags.mode === 'OBJECT') {
                            print_token();
                            print_newline();
                        }
                        else {
                            // EXPR or DO_BLOCK
                            print_token();
                            print_single_space();
                        }
                    }
                    break;
                case 'TK_OPERATOR':
                    var space_before = true;
                    var space_after = true;
                    if (is_special_word(last_text)) {
                        // "return" had a special handling in TK_WORD. Now we need to return the favor
                        print_single_space();
                        print_token();
                        break;
                    }
                    // hack for actionscript's import .*;
                    if (token_text === '*' && last_type === 'TK_UNKNOWN' && !last_last_text.match(/^\d+$/)) {
                        print_token();
                        break;
                    }
                    if (token_text === ':' && flags.in_case) {
                        if (opt_indent_case) {
                            flags.case_body = true;
                        }
                        print_token(); // colon really asks for separate treatment
                        print_newline();
                        flags.in_case = false;
                        break;
                    }
                    if (token_text === '::') {
                        // no spaces around exotic namespacing syntax operator
                        print_token();
                        break;
                    }
                    if (in_array(token_text, ['--', '++', '!']) || (in_array(token_text, ['-', '+']) && (in_array(last_type, ['TK_START_BLOCK', 'TK_START_EXPR', 'TK_EQUALS', 'TK_OPERATOR']) || in_array(last_text, line_starters)))) {
                        // unary operators (and binary +/- pretending to be unary) special cases
                        space_before = false;
                        space_after = false;
                        if (last_text === ';' && is_expression(flags.mode)) {
                            // for (;; ++i)
                            //        ^^^
                            space_before = true;
                        }
                        if (last_type === 'TK_WORD' && in_array(last_text, line_starters)) {
                            space_before = true;
                        }
                        if (flags.mode === 'BLOCK' && (last_text === '{' || last_text === ';')) {
                            // { foo; --i }
                            // foo(); --bar;
                            print_newline();
                        }
                    }
                    else if (token_text === '.') {
                        // decimal digits or object.property
                        space_before = false;
                    }
                    else if (token_text === ':') {
                        if (flags.ternary_depth === 0) {
                            if (flags.mode === 'BLOCK') {
                                flags.mode = 'OBJECT';
                            }
                            space_before = false;
                        }
                        else {
                            flags.ternary_depth -= 1;
                        }
                    }
                    else if (token_text === '?') {
                        flags.ternary_depth += 1;
                    }
                    if (space_before) {
                        print_single_space();
                    }
                    print_token();
                    if (space_after) {
                        print_single_space();
                    }
                    break;
                case 'TK_BLOCK_COMMENT':
                    var lines = split_newlines(token_text);
                    var j; // iterator for this case
                    if (all_lines_start_with(lines.slice(1), '*')) {
                        // javadoc: reformat and reindent
                        print_newline();
                        output.push(lines[0]);
                        for (j = 1; j < lines.length; j++) {
                            print_newline();
                            output.push(' ');
                            output.push(trim(lines[j]));
                        }
                    }
                    else {
                        // simple block comment: leave intact
                        if (lines.length > 1) {
                            // multiline comment block starts with a new line
                            print_newline();
                        }
                        else {
                            // single-line /* comment */ stays where it is
                            if (last_type === 'TK_END_BLOCK') {
                                print_newline();
                            }
                            else {
                                print_single_space();
                            }
                        }
                        for (j = 0; j < lines.length; j++) {
                            output.push(lines[j]);
                            output.push("\n");
                        }
                    }
                    if (look_up('\n') !== '\n') {
                        print_newline();
                    }
                    break;
                case 'TK_INLINE_COMMENT':
                    print_single_space();
                    print_token();
                    if (is_expression(flags.mode)) {
                        print_single_space();
                    }
                    else {
                        force_newline();
                    }
                    break;
                case 'TK_COMMENT':
                    if (last_text === ',' && !wanted_newline) {
                        trim_output(true);
                    }
                    if (last_type !== 'TK_COMMENT') {
                        if (wanted_newline) {
                            print_newline();
                        }
                        else {
                            print_single_space();
                        }
                    }
                    print_token();
                    print_newline();
                    break;
                case 'TK_UNKNOWN':
                    if (is_special_word(last_text)) {
                        print_single_space();
                    }
                    print_token();
                    break;
                }
                last_last_text = last_text;
                last_type = token_type;
                last_text = token_text;
            }
            var sweet_code = preindent_string + output.join('').replace(/[\r\n ]+$/, '');
            return sweet_code;
        },
        css_beautify: function(source_text, options) {
            options = options || {};
            var indentSize = options.indent_size || 4;
            var indentCharacter = options.indent_char || ' ';
            // compatibility
            if (typeof indentSize == "string") indentSize = parseInt(indentSize);
            // tokenizer
            var whiteRe = /^\s+$/;
            var wordRe = /[\w$\-_]/;
            var pos = -1,
                ch;

            function next() {
                return ch = source_text.charAt(++pos)
            }

            function peek() {
                return source_text.charAt(pos + 1)
            }

            function eatString(comma) {
                var start = pos;
                while (next()) {
                    if (ch == "\\") {
                        next();
                        next();
                    }
                    else if (ch == comma) {
                        break;
                    }
                    else if (ch == "\n") {
                        break;
                    }
                }
                return source_text.substring(start, pos + 1);
            }

            function eatWhitespace() {
                var start = pos;
                while (whiteRe.test(peek()))
                pos++;
                return pos != start;
            }

            function skipWhitespace() {
                var start = pos;
                do {} while (whiteRe.test(next()))
                return pos != start + 1;
            }

            function eatComment() {
                var start = pos;
                next();
                while (next()) {
                    if (ch == "*" && peek() == "/") {
                        pos++;
                        break;
                    }
                }
                return source_text.substring(start, pos + 1);
            }

            function lookBack(str, index) {
                return output.slice(-str.length + (index || 0), index).join("").toLowerCase() == str;
            }
            // printer
            var indentString = source_text.match(/^[\r\n]*[\t ]*/)[0];
            var singleIndent = Array(indentSize + 1).join(indentCharacter);
            var indentLevel = 0;

            function indent() {
                indentLevel++;
                indentString += singleIndent;
            }

            function outdent() {
                indentLevel--;
                indentString = indentString.slice(0, - indentSize);
            }
            print = {}
            print["{"] = function(ch) {
                print.singleSpace();
                output.push(ch);
                print.newLine();
            }
            print["}"] = function(ch) {
                print.newLine();
                output.push(ch);
                print.newLine();
            }
            print.newLine = function(keepWhitespace) {
                if (!keepWhitespace) while (whiteRe.test(output[output.length - 1]))
                output.pop();
                if (output.length) output.push('\n');
                if (indentString) output.push(indentString);
            }
            print.singleSpace = function() {
                if (output.length && !whiteRe.test(output[output.length - 1])) output.push(' ');
            }
            var output = [];
            if (indentString) output.push(indentString);
            /*_____________________--------------------_____________________*/
            while (true) {
                var isAfterSpace = skipWhitespace();
                if (!ch) break;
                if (ch == '{') {
                    indent();
                    print["{"](ch);
                }
                else if (ch == '}') {
                    outdent();
                    print["}"](ch);
                }
                else if (ch == '"' || ch == '\'') {
                    output.push(eatString(ch))
                }
                else if (ch == ';') {
                    output.push(ch, '\n', indentString);
                }
                else if (ch == '/' && peek() == '*') { // comment
                    print.newLine();
                    output.push(eatComment(), "\n", indentString);
                }
                else if (ch == '(') { // may be a url
                    output.push(ch);
                    eatWhitespace();
                    if (lookBack("url", - 1) && next()) {
                        if (ch != ')' && ch != '"' && ch != '\'') output.push(eatString(')'));
                        else pos--;
                    }
                }
                else if (ch == ')') {
                    output.push(ch);
                }
                else if (ch == ',') {
                    eatWhitespace();
                    output.push(ch);
                    print.singleSpace();
                }
                else if (ch == ']') {
                    output.push(ch);
                }
                else if (ch == '[' || ch == '=') { // no whitespace before or after
                    eatWhitespace();
                    output.push(ch);
                }
                else {
                    if (isAfterSpace) print.singleSpace();
                    output.push(ch);
                }
            }
            var sweetCode = output.join('').replace(/[\n ]+$/, '');
            return sweetCode;
        },
        html_beautify: function(html_source, options) {
            //Wrapper function to invoke all the necessary constructors and deal with the output.
            var multi_parser,
            indent_size,
            indent_character,
            max_char,
            brace_style;
            options = options || {};
            indent_size = options.indent_size || 4;
            indent_character = options.indent_char || ' ';
            brace_style = options.brace_style || 'collapse';
            max_char = options.max_char == 0 ? Infinity : options.max_char || 70;
            unformatted = options.unformatted || ['a'];

            function Parser() {
                this.pos = 0; //Parser position
                this.token = '';
                this.current_mode = 'CONTENT'; //reflects the current Parser mode: TAG/CONTENT
                this.tags = { //An object to hold tags, their position, and their parent-tags, initiated with default values
                    parent: 'parent1',
                    parentcount: 1,
                    parent1: ''
                };
                this.tag_type = '';
                this.token_text = this.last_token = this.last_text = this.token_type = '';
                this.Utils = { //Uilities made available to the various functions
                    whitespace: "\n\r\t ".split(''),
                    single_token: 'br,input,link,meta,!doctype,basefont,base,area,hr,wbr,param,img,isindex,?xml,embed'.split(','), //all the single tags for HTML
                    extra_liners: 'head,body,/html'.split(','), //for tags that need a line of whitespace before them
                    in_array: function(what, arr) {
                        for (var i = 0; i < arr.length; i++) {
                            if (what === arr[i]) {
                                return true;
                            }
                        }
                        return false;
                    }
                }
                this.get_content = function() { //function to capture regular content between tags
                    var input_char = '';
                    var content = [];
                    var space = false; //if a space is needed
                    while (this.input.charAt(this.pos) !== '<') {
                        if (this.pos >= this.input.length) {
                            return content.length ? content.join('') : ['', 'TK_EOF'];
                        }
                        input_char = this.input.charAt(this.pos);
                        this.pos++;
                        this.line_char_count++;
                        if (this.Utils.in_array(input_char, this.Utils.whitespace)) {
                            if (content.length) {
                                space = true;
                            }
                            this.line_char_count--;
                            continue; //don't want to insert unnecessary space
                        }
                        else if (space) {
                            if (this.line_char_count >= this.max_char) { //insert a line when the max_char is reached
                                content.push('\n');
                                for (var i = 0; i < this.indent_level; i++) {
                                    content.push(this.indent_string);
                                }
                                this.line_char_count = 0;
                            }
                            else {
                                content.push(' ');
                                this.line_char_count++;
                            }
                            space = false;
                        }
                        content.push(input_char); //letter at-a-time (or string) inserted to an array
                    }
                    return content.length ? content.join('') : '';
                }
                this.get_contents_to = function(name) { //get the full content of a script or style to pass to js_beautify
                    if (this.pos == this.input.length) {
                        return ['', 'TK_EOF'];
                    }
                    var input_char = '';
                    var content = '';
                    var reg_match = new RegExp('\<\/' + name + '\\s*\>', 'igm');
                    reg_match.lastIndex = this.pos;
                    var reg_array = reg_match.exec(this.input);
                    var end_script = reg_array ? reg_array.index : this.input.length; //absolute end of script
                    if (this.pos < end_script) { //get everything in between the script tags
                        content = this.input.substring(this.pos, end_script);
                        this.pos = end_script;
                    }
                    return content;
                }
                this.record_tag = function(tag) { //function to record a tag and its parent in this.tags Object
                    if (this.tags[tag + 'count']) { //check for the existence of this tag type
                        this.tags[tag + 'count']++;
                        this.tags[tag + this.tags[tag + 'count']] = this.indent_level; //and record the present indent level
                    }
                    else { //otherwise initialize this tag type
                        this.tags[tag + 'count'] = 1;
                        this.tags[tag + this.tags[tag + 'count']] = this.indent_level; //and record the present indent level
                    }
                    this.tags[tag + this.tags[tag + 'count'] + 'parent'] = this.tags.parent; //set the parent (i.e. in the case of a div this.tags.div1parent)
                    this.tags.parent = tag + this.tags[tag + 'count']; //and make this the current parent (i.e. in the case of a div 'div1')
                }
                this.retrieve_tag = function(tag) { //function to retrieve the opening tag to the corresponding closer
                    if (this.tags[tag + 'count']) { //if the openener is not in the Object we ignore it
                        var temp_parent = this.tags.parent; //check to see if it's a closable tag.
                        while (temp_parent) { //till we reach '' (the initial value);
                            if (tag + this.tags[tag + 'count'] === temp_parent) { //if this is it use it
                                break;
                            }
                            temp_parent = this.tags[temp_parent + 'parent']; //otherwise keep on climbing up the DOM Tree
                        }
                        if (temp_parent) { //if we caught something
                            this.indent_level = this.tags[tag + this.tags[tag + 'count']]; //set the indent_level accordingly
                            this.tags.parent = this.tags[temp_parent + 'parent']; //and set the current parent
                        }
                        delete this.tags[tag + this.tags[tag + 'count'] + 'parent']; //delete the closed tags parent reference...
                        delete this.tags[tag + this.tags[tag + 'count']]; //...and the tag itself
                        if (this.tags[tag + 'count'] == 1) {
                            delete this.tags[tag + 'count'];
                        }
                        else {
                            this.tags[tag + 'count']--;
                        }
                    }
                }
                this.get_tag = function() { //function to get a full tag and parse its type
                    var input_char = '';
                    var content = [];
                    var space = false;
                    do {
                        if (this.pos >= this.input.length) {
                            return content.length ? content.join('') : ['', 'TK_EOF'];
                        }
                        input_char = this.input.charAt(this.pos);
                        this.pos++;
                        this.line_char_count++;
                        if (this.Utils.in_array(input_char, this.Utils.whitespace)) { //don't want to insert unnecessary space
                            space = true;
                            this.line_char_count--;
                            continue;
                        }
                        if (input_char === "'" || input_char === '"') {
                            if (!content[1] || content[1] !== '!') { //if we're in a comment strings don't get treated specially
                                input_char += this.get_unformatted(input_char);
                                space = true;
                            }
                        }
                        if (input_char === '=') { //no space before =
                            space = false;
                        }
                        if (content.length && content[content.length - 1] !== '=' && input_char !== '>' && space) { //no space after = or before >
                            if (this.line_char_count >= this.max_char) {
                                this.print_newline(false, content);
                                this.line_char_count = 0;
                            }
                            else {
                                content.push(' ');
                                this.line_char_count++;
                            }
                            space = false;
                        }
                        content.push(input_char); //inserts character at-a-time (or string)
                    } while (input_char !== '>');
                    var tag_complete = content.join('');
                    var tag_index;
                    if (tag_complete.indexOf(' ') != -1) { //if there's whitespace, thats where the tag name ends
                        tag_index = tag_complete.indexOf(' ');
                    }
                    else { //otherwise go with the tag ending
                        tag_index = tag_complete.indexOf('>');
                    }
                    var tag_check = tag_complete.substring(1, tag_index).toLowerCase();
                    if (tag_complete.charAt(tag_complete.length - 2) === '/' || this.Utils.in_array(tag_check, this.Utils.single_token)) { //if this tag name is a single tag type (either in the list or has a closing /)
                        this.tag_type = 'SINGLE';
                    }
                    else if (tag_check === 'script') { //for later script handling
                        this.record_tag(tag_check);
                        this.tag_type = 'SCRIPT';
                    }
                    else if (tag_check === 'style') { //for future style handling (for now it justs uses get_content)
                        this.record_tag(tag_check);
                        this.tag_type = 'STYLE';
                    }
                    else if (this.Utils.in_array(tag_check, unformatted)) { // do not reformat the "unformatted" tags
                        var comment = this.get_unformatted('</' + tag_check + '>', tag_complete); //...delegate to get_unformatted function
                        content.push(comment);
                        this.tag_type = 'SINGLE';
                    }
                    else if (tag_check.charAt(0) === '!') { //peek for <!-- comment
                        if (tag_check.indexOf('[if') != -1) { //peek for <!--[if conditional comment
                            if (tag_complete.indexOf('!IE') != -1) { //this type needs a closing --> so...
                                var comment = this.get_unformatted('-->', tag_complete); //...delegate to get_unformatted
                                content.push(comment);
                            }
                            this.tag_type = 'START';
                        }
                        else if (tag_check.indexOf('[endif') != -1) { //peek for <!--[endif end conditional comment
                            this.tag_type = 'END';
                            this.unindent();
                        }
                        else if (tag_check.indexOf('[cdata[') != -1) { //if it's a <[cdata[ comment...
                            var comment = this.get_unformatted(']]>', tag_complete); //...delegate to get_unformatted function
                            content.push(comment);
                            this.tag_type = 'SINGLE'; //<![CDATA[ comments are treated like single tags
                        }
                        else {
                            var comment = this.get_unformatted('-->', tag_complete);
                            content.push(comment);
                            this.tag_type = 'SINGLE';
                        }
                    }
                    else {
                        if (tag_check.charAt(0) === '/') { //this tag is a double tag so check for tag-ending
                            this.retrieve_tag(tag_check.substring(1)); //remove it and all ancestors
                            this.tag_type = 'END';
                        }
                        else { //otherwise it's a start-tag
                            this.record_tag(tag_check); //push it on the tag stack
                            this.tag_type = 'START';
                        }
                        if (this.Utils.in_array(tag_check, this.Utils.extra_liners)) { //check if this double needs an extra line
                            this.print_newline(true, this.output);
                        }
                    }
                    return content.join(''); //returns fully formatted tag
                }
                this.get_unformatted = function(delimiter, orig_tag) { //function to return unformatted content in its entirety
                    if (orig_tag && orig_tag.indexOf(delimiter) != -1) {
                        return '';
                    }
                    var input_char = '';
                    var content = '';
                    var space = true;
                    do {
                        if (this.pos >= this.input.length) {
                            return content;
                        }
                        input_char = this.input.charAt(this.pos);
                        this.pos++
                        if (this.Utils.in_array(input_char, this.Utils.whitespace)) {
                            if (!space) {
                                this.line_char_count--;
                                continue;
                            }
                            if (input_char === '\n' || input_char === '\r') {
                                content += '\n';
                                /*  Don't change tab indention for unformatted blocks.  If using code for html editing, this will greatly affect <pre> tags if they are specified in the 'unformatted array'
                                for (var i=0; i<this.indent_level; i++) {
                                  content += this.indent_string;
                                }
                                space = false; //...and make sure other indentation is erased
                                */
                                this.line_char_count = 0;
                                continue;
                            }
                        }
                        content += input_char;
                        this.line_char_count++;
                        space = true;
                    } while (content.indexOf(delimiter) == -1);
                    return content;
                }
                this.get_token = function() { //initial handler for token-retrieval
                    var token;
                    if (this.last_token === 'TK_TAG_SCRIPT' || this.last_token === 'TK_TAG_STYLE') { //check if we need to format javascript
                        var type = this.last_token.substr(7)
                        token = this.get_contents_to(type);
                        if (typeof token !== 'string') {
                            return token;
                        }
                        return [token, 'TK_' + type];
                    }
                    if (this.current_mode === 'CONTENT') {
                        token = this.get_content();
                        if (typeof token !== 'string') {
                            return token;
                        }
                        else {
                            return [token, 'TK_CONTENT'];
                        }
                    }
                    if (this.current_mode === 'TAG') {
                        token = this.get_tag();
                        if (typeof token !== 'string') {
                            return token;
                        }
                        else {
                            var tag_name_type = 'TK_TAG_' + this.tag_type;
                            return [token, tag_name_type];
                        }
                    }
                }
                this.get_full_indent = function(level) {
                    level = this.indent_level + level || 0;
                    if (level < 1) return '';
                    return Array(level + 1).join(this.indent_string);
                }
                this.printer = function(js_source, indent_character, indent_size, max_char, brace_style) { //handles input/output and some other printing functions
                    this.input = js_source || ''; //gets the input for the Parser
                    this.output = [];
                    this.indent_character = indent_character;
                    this.indent_string = '';
                    this.indent_size = indent_size;
                    this.brace_style = brace_style;
                    this.indent_level = 0;
                    this.max_char = max_char;
                    this.line_char_count = 0; //count to see if max_char was exceeded
                    for (var i = 0; i < this.indent_size; i++) {
                        this.indent_string += this.indent_character;
                    }
                    this.print_newline = function(ignore, arr) {
                        this.line_char_count = 0;
                        if (!arr || !arr.length) {
                            return;
                        }
                        if (!ignore) { //we might want the extra line
                            while (this.Utils.in_array(arr[arr.length - 1], this.Utils.whitespace)) {
                                arr.pop();
                            }
                        }
                        arr.push('\n');
                        for (var i = 0; i < this.indent_level; i++) {
                            arr.push(this.indent_string);
                        }
                    }
                    this.print_token = function(text) {
                        this.output.push(text);
                    }
                    this.indent = function() {
                        this.indent_level++;
                    }
                    this.unindent = function() {
                        if (this.indent_level > 0) {
                            this.indent_level--;
                        }
                    }
                }
                return this;
            }
            /*_____________________--------------------_____________________*/
            multi_parser = new Parser(); //wrapping functions Parser
            multi_parser.printer(html_source, indent_character, indent_size, max_char, brace_style); //initialize starting values
            while (true) {
                var t = multi_parser.get_token();
                multi_parser.token_text = t[0];
                multi_parser.token_type = t[1];
                if (multi_parser.token_type === 'TK_EOF') {
                    break;
                }
                switch (multi_parser.token_type) {
                case 'TK_TAG_START':
                    multi_parser.print_newline(false, multi_parser.output);
                    multi_parser.print_token(multi_parser.token_text);
                    multi_parser.indent();
                    multi_parser.current_mode = 'CONTENT';
                    break;
                case 'TK_TAG_STYLE':
                case 'TK_TAG_SCRIPT':
                    multi_parser.print_newline(false, multi_parser.output);
                    multi_parser.print_token(multi_parser.token_text);
                    multi_parser.current_mode = 'CONTENT';
                    break;
                case 'TK_TAG_END':
                    //Print new line only if the tag has no content and has child
                    if (multi_parser.last_token === 'TK_CONTENT' && multi_parser.last_text === '') {
                        var tag_name = multi_parser.token_text.match(/\w+/)[0];
                        var tag_extracted_from_last_output = multi_parser.output[multi_parser.output.length - 1].match(/<\s*(\w+)/);
                        if (tag_extracted_from_last_output === null || tag_extracted_from_last_output[1] !== tag_name) multi_parser.print_newline(true, multi_parser.output);
                    }
                    multi_parser.print_token(multi_parser.token_text);
                    multi_parser.current_mode = 'CONTENT';
                    break;
                case 'TK_TAG_SINGLE':
                    multi_parser.print_newline(false, multi_parser.output);
                    multi_parser.print_token(multi_parser.token_text);
                    multi_parser.current_mode = 'CONTENT';
                    break;
                case 'TK_CONTENT':
                    if (multi_parser.token_text !== '') {
                        multi_parser.print_token(multi_parser.token_text);
                    }
                    multi_parser.current_mode = 'TAG';
                    break;
                case 'TK_STYLE':
                case 'TK_SCRIPT':
                    if (multi_parser.token_text !== '') {
                        multi_parser.output.push('\n');
                        var text = multi_parser.token_text;
                        if (multi_parser.token_type == 'TK_SCRIPT') {
                            var _beautifier = typeof js_beautify == 'function' && js_beautify;
                        }
                        else if (multi_parser.token_type == 'TK_STYLE') {
                            var _beautifier = typeof css_beautify == 'function' && css_beautify;
                        }
                        if (options.indent_scripts == "keep") {
                            var script_indent_level = 0;
                        }
                        else if (options.indent_scripts == "separate") {
                            var script_indent_level = -multi_parser.indent_level;
                        }
                        else {
                            var script_indent_level = 1;
                        }
                        var indentation = multi_parser.get_full_indent(script_indent_level);
                        if (_beautifier) {
                            // call the Beautifier if avaliable
                            text = _beautifier(text.replace(/^\s*/, indentation), options);
                        }
                        else {
                            // simply indent the string otherwise
                            var white = text.match(/^\s*/)[0];
                            var _level = white.match(/[^\n\r]*$/)[0].split(multi_parser.indent_string).length - 1;
                            var reindent = multi_parser.get_full_indent(script_indent_level - _level);
                            text = text.replace(/^\s*/, indentation).replace(/\r\n|\r|\n/g, '\n' + reindent).replace(/\s*$/, '');
                        }
                        if (text) {
                            multi_parser.print_token(text);
                            multi_parser.print_newline(true, multi_parser.output);
                        }
                    }
                    multi_parser.current_mode = 'TAG';
                    break;
                }
                multi_parser.last_token = multi_parser.token_type;
                multi_parser.last_text = multi_parser.token_text;
            }
            return multi_parser.output.join('');
        }
    };
    //cleanup ace
    function aceBeautify(editor, unselect) {
        //param unselect- if true, then unselect the selection after execution
        var sel = editor.selection;
        var session = editor.session;
        var range = sel.getRange();
        //if nothing is selected, then select all
        var formatAll = false;
        var originalRangeStart = editor.selection.getRange().start;
        if (range.start.row === range.end.row && range.start.column === range.end.column) {
            //log('originalRangeStart', originalRangeStart);
            range.start.row = 0;
            range.start.column = 0;
            var lastLine = editor.session.getLength() - 1;
            range.end.row = lastLine;
            range.end.column = editor.session.getLine(lastLine).length;
            formatAll = true;
        }
        var options = {};
        options.space_before_conditional = true;
        options.keep_array_indentation = false;
        options.preserve_newlines = true;
        options.unescape_strings = true;
        options.jslint_happy = false;
        options.indent_size = '4';
        options.indent_char = ' ';
        options.max_preserve_newlines = 2;
        options.preserve_newlines = options.max_preserve_newlines !== -1;
        options.keep_array_indentation = false;
        options.break_chained_methods = false;
        options.indent_scripts = 'normal';
        options.brace_style = 'end-expand'; /*[collapse|expand|end-expand]*/
        options.space_before_conditional = true;
        options.unescape_strings = false;
        options.wrap_line_length = '0';
        options.space_after_anon_function = true;
        options.max_char = 0; //html beautifys wrap option
        /* html beautify options
          'indent_inner_html': false,
          'indent_size': 2,
          'indent_char': ' ',
          'wrap_line_length': 78,
          'brace_style': 'expand',
          'unformatted': ['a', 'sub', 'sup', 'b', 'i', 'u'],
          'preserve_newlines': true,
          'max_preserve_newlines': 5,
          'indent_handlebars': false
        */
        if (session.getUseSoftTabs()) {
            options.indent_char = " ";
            options.indent_size = session.getTabSize();
        }
        else {
            options.indent_char = "\t";
            options.indent_size = 1;
        }
        var line = session.getLine(range.start.row);
        var indent = line.match(/^\s*/)[0];
        var trim = false;
        if (range.start.column < indent.length) range.start.column = 0;
        else trim = true;
        var value = session.getTextRange(range);
        //$("[data-mode]").parent().removeClass("active");
        //var syntax = session.syntax;
        var type = null;
        var detectedMode = getCurrentMode(editor, false);
        if (detectedMode == "javascript") {
            type = "js";
        }
        else if (detectedMode == "css") {
            type = "css";
        }
        if (/^\s*<!?\w/.test(value)) {
            type = "html";
        }
        else if (detectedMode == "xml") {
            type = "html";
        }
        else if (detectedMode == "html") {
            if (/[^<]+?\{[\s\-\w]+:[^}]+;/.test(value)) type = "css";
            else if (/<\w+[ \/>]/.test(value)) type = "html";
            else type = "js";
        }
        else if (detectedMode == "json") {
            type = "js";
        }
        try {
            value = jsbeautify[type + "_beautify"](value, options);
            if (trim) value = value.replace(/^/gm, indent).trim();
            if (range.end.column === 0) value += "\n" + indent;
        }
        catch (e) {
            window.alert("Error: This code could not be beautified " + detectedMode + " is not supported yet");
            return;
        }
        if (!formatAll) {
            var end = session.replace(range, value);
            if (unselect) {
                sel.setSelectionRange(Range.fromPoints(end, end));
            }
            else {
                sel.setSelectionRange(Range.fromPoints(range.start, end));
            }
        }
        else {
            //log('set  original', originalRangeStart);
            session.replace(range, value);
            sel.setSelectionRange(Range.fromPoints(originalRangeStart, originalRangeStart));
        }
    }
    //NOTE: the keybinding here doesn't work, instead i added it to the keys.json (but the command binding here is needed)
    editor.commands.addCommand({
        name: 'beautify',
        bindKey: {
            mac: "Command-B",
            win: "Ctrl-B"
        },
        exec: aceBeautify,
        readOnly: false // false if this command should not apply in readOnly mode
    });
    //add auto beautify
    editor.commands.on('afterExec', function(e) {
        if (e.command.name === "insertstring" && e.args === "}") {
            var m = getCurrentMode(editor, true);
            if (m !== 'javascript' && m !== 'css') {
                return;
            }
            var pos = editor.getSelectionRange().end;
            var tok = editor.session.getTokenAt(pos.row, pos.column);
            if (tok) {
                if (tok.type !== 'string' && tok.type.toString().indexOf('comment') === -1) {
                    editor.jumpToMatching(true); //jumpto and select
                    editor.execCommand('beautify', true);
                }
            }
        }
        //testing auto beautify
        function getMatching(select) {
            var cursor = editor.getCursorPosition();
            var range = editor.session.getBracketRange(cursor);
            if (!range) {
                range = editor.find({
                    needle: /[{}()\[\]]/g,
                    preventScroll: true,
                    start: {
                        row: cursor.row,
                        column: cursor.column - 1
                    }
                });
                if (!range) return;
                var pos = range.start;
                if (pos.row == cursor.row && Math.abs(pos.column - cursor.column) < 2) range = editor.session.getBracketRange(pos);
            }
            pos = range && range.cursor || pos;
            if (pos) {
                if (select) {
                    if (range && range.isEqual(editor.getSelectionRange())) {
                        editor.clearSelection();
                    }
                    else editor.selection.selectTo(pos.row, pos.column);
                }
                else {
                    editor.selection.moveTo(pos.row, pos.column);
                }
            }
        }
    });
    //#endregion


    //#region ShowMessage
    window.alert = function(s) {
        command.fire("app:show-prompt");
        var cmd = document.find(".command-line input");
        cmd.style.color = "red"; //note: will be set back to red on next show
        cmd.value = s.toString();
    };
    window.command = command; //debugging
    console.log('global: command (caret command manager); commandList(filter): list all commands with optional filter');
    //lists commands in console with optional filter
    window.commandList = function(filter){
        var arr = [];
        for (var i = 0; i < command.list.length; i++) {
            var c = command.list[i];
            var s = c.command;
            s += c.argument ? " - " + c.argument : "";
            if (filter) {
                if (s.toLowerCase().indexOf(filter.toLowerCase().trim()) === -1) continue;
            }
            arr.push(s);
        }
        arr.sort();
        console.log(arr.join("\n"));
    };
    
    
    
    
  
    //#endregion


    //#region DefaultCommands
    var defaultFontSize = function(c) {
        var size = Settings.get("user").fontSize;
        editor.container.style.fontSize = size ? size + "px" : null;
        if (c) c();
    };
    var adjustFontSize = function(delta, c) {
        var current = editor.container.style.fontSize;
        if (current) {
            current = current.replace("px", "") * 1;
        }
        else {
            current = Settings.get("user").fontSize;
        }
        var adjusted = current + delta;
        editor.container.style.fontSize = adjusted + "px";
        if (c) c();
    };
    command.on("editor:default-zoom", defaultFontSize);
    command.on("editor:adjust-zoom", adjustFontSize);
    command.on("init:startup", init);
    command.on("init:restart", reset);
    command.on("editor:theme", function(theme, c) {
        editor.setTheme("ace/theme/" + theme);
        themes.value = theme;
        editor.focus();
        if (c) c();
    });
    command.on("editor:print", function(c) {
        ace.require("ace/config").loadModule("ace/ext/static_highlight", function(static) {
            var session = editor.getSession();
            var printable = static.renderSync(session.getValue(), session.getMode(), editor.renderer.theme);
            var iframe = document.createElement("iframe");
            var css = "<style>" + printable.css + "</style>";
            var doc = css + printable.html;
            iframe.srcdoc = doc;
            iframe.width = iframe.height = 1;
            iframe.style.display = "none";
            document.body.append(iframe);
            setTimeout(function() {
                iframe.contentWindow.print();
                setTimeout(function() {
                    iframe.remove();
                });
            });
        });
    });
    command.on("editor:word-count", function(c) {
        var text = editor.getSession().getValue();
        var lines = text.split("\n").length + " lines";
        var characters = text.length + " characters";
        var words = text.match(/\b\S+\b/g);
        words = words ? words.length : 0;
        words += " words";
        command.fire("status:toast", [characters, words, lines].join(", "));
    });
    return editor;
    //#endregion


});