"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = exports.EXECUTION_TYPES = void 0;
const tokenizer_1 = require("./tokenizer");
/**
 * Execution types allow to know what is the query behavior
 *  - LISTING: is when the query list the data
 *  - MODIFICATION: is when the query modificate the database somehow (structure or data)
 *  - INFORMATION: is show some data information such as a profile data
 *  - UNKNOWN
 */
exports.EXECUTION_TYPES = {
    SELECT: 'LISTING',
    INSERT: 'MODIFICATION',
    DELETE: 'MODIFICATION',
    UPDATE: 'MODIFICATION',
    TRUNCATE: 'MODIFICATION',
    CREATE_DATABASE: 'MODIFICATION',
    CREATE_SCHEMA: 'MODIFICATION',
    CREATE_TABLE: 'MODIFICATION',
    CREATE_VIEW: 'MODIFICATION',
    CREATE_TRIGGER: 'MODIFICATION',
    CREATE_FUNCTION: 'MODIFICATION',
    CREATE_INDEX: 'MODIFICATION',
    CREATE_PROCEDURE: 'MODIFICATION',
    DROP_DATABASE: 'MODIFICATION',
    DROP_SCHEMA: 'MODIFICATION',
    DROP_TABLE: 'MODIFICATION',
    DROP_VIEW: 'MODIFICATION',
    DROP_TRIGGER: 'MODIFICATION',
    DROP_FUNCTION: 'MODIFICATION',
    DROP_INDEX: 'MODIFICATION',
    ALTER_DATABASE: 'MODIFICATION',
    ALTER_SCHEMA: 'MODIFICATION',
    ALTER_TABLE: 'MODIFICATION',
    ALTER_VIEW: 'MODIFICATION',
    ALTER_TRIGGER: 'MODIFICATION',
    ALTER_FUNCTION: 'MODIFICATION',
    ALTER_INDEX: 'MODIFICATION',
    UNKNOWN: 'UNKNOWN',
    ANON_BLOCK: 'ANON_BLOCK',
};
const statementsWithEnds = ['CREATE_TRIGGER', 'CREATE_FUNCTION', 'CREATE_PROCEDURE', 'ANON_BLOCK'];
const blockOpeners = {
    generic: ['BEGIN', 'CASE'],
    psql: ['BEGIN', 'CASE', 'LOOP', 'IF'],
    mysql: ['BEGIN', 'CASE', 'LOOP', 'IF'],
    mssql: ['BEGIN', 'CASE'],
    sqlite: ['BEGIN', 'CASE'],
    oracle: ['DECLARE', 'BEGIN', 'CASE'],
    bigquery: ['DECLARE', 'BEGIN', 'CASE'],
};
function createInitialStatement() {
    return {
        start: -1,
        end: 0,
        parameters: [],
    };
}
/**
 * Parser
 */
function parse(input, isStrict = true, dialect = 'generic') {
    const topLevelState = initState({ input });
    const topLevelStatement = {
        type: 'QUERY',
        start: 0,
        end: input.length - 1,
        body: [],
        tokens: [],
    };
    let prevState = topLevelState;
    let statementParser = null;
    const cteState = {
        isCte: false,
        asSeen: false,
        statementEnd: false,
        parens: 0,
        state: topLevelState,
    };
    const ignoreOutsideBlankTokens = ['whitespace', 'comment-inline', 'comment-block', 'semicolon'];
    while (prevState.position < topLevelState.end) {
        const tokenState = initState({ prevState });
        const token = (0, tokenizer_1.scanToken)(tokenState, dialect);
        if (!statementParser) {
            // ignore blank tokens before the start of a CTE / not part of a statement
            if (!cteState.isCte && ignoreOutsideBlankTokens.includes(token.type)) {
                topLevelStatement.tokens.push(token);
                prevState = tokenState;
                continue;
            }
            else if (!cteState.isCte &&
                token.type === 'keyword' &&
                token.value.toUpperCase() === 'WITH') {
                cteState.isCte = true;
                topLevelStatement.tokens.push(token);
                cteState.state = tokenState;
                prevState = tokenState;
                continue;
                // If we're scanning in a CTE, handle someone putting a semicolon anywhere (after 'with',
                // after semicolon, etc.) along it to "early terminate".
            }
            else if (cteState.isCte && token.type === 'semicolon') {
                topLevelStatement.tokens.push(token);
                prevState = tokenState;
                topLevelStatement.body.push({
                    start: cteState.state.start,
                    end: token.end,
                    type: 'UNKNOWN',
                    executionType: 'UNKNOWN',
                    parameters: [],
                });
                cteState.isCte = false;
                cteState.asSeen = false;
                cteState.statementEnd = false;
                cteState.parens = 0;
                continue;
            }
            else if (cteState.isCte && !cteState.statementEnd) {
                if (cteState.asSeen) {
                    if (token.value === '(') {
                        cteState.parens++;
                    }
                    else if (token.value === ')') {
                        cteState.parens--;
                        if (cteState.parens === 0) {
                            cteState.statementEnd = true;
                        }
                    }
                }
                else if (token.value.toUpperCase() === 'AS') {
                    cteState.asSeen = true;
                }
                topLevelStatement.tokens.push(token);
                prevState = tokenState;
                continue;
            }
            else if (cteState.isCte && cteState.statementEnd && token.value === ',') {
                cteState.asSeen = false;
                cteState.statementEnd = false;
                topLevelStatement.tokens.push(token);
                prevState = tokenState;
                continue;
                // Ignore blank tokens after the end of the CTE till start of statement
            }
            else if (cteState.isCte &&
                cteState.statementEnd &&
                ignoreOutsideBlankTokens.includes(token.type)) {
                topLevelStatement.tokens.push(token);
                prevState = tokenState;
                continue;
            }
            statementParser = createStatementParserByToken(token, { isStrict, dialect });
            if (cteState.isCte) {
                statementParser.getStatement().start = cteState.state.start;
                cteState.isCte = false;
                cteState.asSeen = false;
                cteState.statementEnd = false;
            }
        }
        statementParser.addToken(token);
        topLevelStatement.tokens.push(token);
        prevState = tokenState;
        const statement = statementParser.getStatement();
        if (statement.endStatement) {
            statement.end = token.end;
            topLevelStatement.body.push(statement);
            statementParser = null;
        }
    }
    // last statement without ending key
    if (statementParser) {
        const statement = statementParser.getStatement();
        if (!statement.endStatement) {
            statement.end = topLevelStatement.end;
            topLevelStatement.body.push(statement);
        }
    }
    return topLevelStatement;
}
exports.parse = parse;
function initState({ input, prevState }) {
    if (prevState) {
        return {
            input: prevState.input,
            position: prevState.position,
            start: prevState.position + 1,
            end: prevState.input.length - 1,
        };
    }
    else if (input === undefined) {
        throw new Error('You must define either input or prevState');
    }
    return {
        input,
        position: -1,
        start: 0,
        end: input.length - 1,
    };
}
function createStatementParserByToken(token, options) {
    if (token.type === 'keyword') {
        switch (token.value.toUpperCase()) {
            case 'SELECT':
                return createSelectStatementParser(options);
            case 'CREATE':
                return createCreateStatementParser(options);
            case 'DROP':
                return createDropStatementParser(options);
            case 'ALTER':
                return createAlterStatementParser(options);
            case 'INSERT':
                return createInsertStatementParser(options);
            case 'UPDATE':
                return createUpdateStatementParser(options);
            case 'DELETE':
                return createDeleteStatementParser(options);
            case 'TRUNCATE':
                return createTruncateStatementParser(options);
            case 'DECLARE':
            case 'BEGIN':
                if (['oracle', 'bigquery'].includes(options.dialect)) {
                    return createBlockStatementParser(options);
                }
            // eslint-disable-next-line no-fallthrough
            default:
                break;
        }
    }
    if (!options.isStrict) {
        return createUnknownStatementParser(options);
    }
    throw new Error(`Invalid statement parser "${token.value}"`);
}
function createSelectStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        // Select
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [{ type: 'keyword', value: 'SELECT' }],
            },
            add: (token) => {
                statement.type = 'SELECT';
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createBlockStatementParser(options) {
    const statement = createInitialStatement();
    statement.type = 'ANON_BLOCK';
    const steps = [
        // Select
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [
                    { type: 'keyword', value: 'DECLARE' },
                    { type: 'keyword', value: 'BEGIN' },
                ],
            },
            add: (token) => {
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createInsertStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        // Insert
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [{ type: 'keyword', value: 'INSERT' }],
            },
            add: (token) => {
                statement.type = 'INSERT';
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createUpdateStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        // Update
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [{ type: 'keyword', value: 'UPDATE' }],
            },
            add: (token) => {
                statement.type = 'UPDATE';
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createDeleteStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        // Delete
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [{ type: 'keyword', value: 'DELETE' }],
            },
            add: (token) => {
                statement.type = 'DELETE';
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createCreateStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        // Create
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [{ type: 'keyword', value: 'CREATE' }],
            },
            add: (token) => {
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
        // Table/Database
        {
            preCanGoToNext: () => false,
            validation: {
                requireBefore: ['whitespace'],
                acceptTokens: [
                    ...(options.dialect !== 'sqlite'
                        ? [
                            { type: 'keyword', value: 'DATABASE' },
                            { type: 'keyword', value: 'SCHEMA' },
                        ]
                        : []),
                    { type: 'keyword', value: 'TABLE' },
                    { type: 'keyword', value: 'VIEW' },
                    { type: 'keyword', value: 'TRIGGER' },
                    { type: 'keyword', value: 'FUNCTION' },
                    { type: 'keyword', value: 'INDEX' },
                    { type: 'keyword', value: 'PROCEDURE' },
                ],
            },
            add: (token) => {
                statement.type = `CREATE_${token.value.toUpperCase()}`;
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createDropStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        // Drop
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [{ type: 'keyword', value: 'DROP' }],
            },
            add: (token) => {
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
        // Table/Database
        {
            preCanGoToNext: () => false,
            validation: {
                requireBefore: ['whitespace'],
                acceptTokens: [
                    ...(options.dialect !== 'sqlite'
                        ? [
                            { type: 'keyword', value: 'DATABASE' },
                            { type: 'keyword', value: 'SCHEMA' },
                        ]
                        : []),
                    { type: 'keyword', value: 'TABLE' },
                    { type: 'keyword', value: 'VIEW' },
                    { type: 'keyword', value: 'TRIGGER' },
                    { type: 'keyword', value: 'FUNCTION' },
                    { type: 'keyword', value: 'INDEX' },
                ],
            },
            add: (token) => {
                statement.type = `DROP_${token.value.toUpperCase()}`;
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createAlterStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [{ type: 'keyword', value: 'ALTER' }],
            },
            add: (token) => {
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
        {
            preCanGoToNext: () => false,
            validation: {
                requireBefore: ['whitespace'],
                acceptTokens: [
                    ...(options.dialect !== 'sqlite'
                        ? [
                            { type: 'keyword', value: 'DATABASE' },
                            { type: 'keyword', value: 'SCHEMA' },
                            { type: 'keyword', value: 'TRIGGER' },
                            { type: 'keyword', value: 'FUNCTION' },
                            { type: 'keyword', value: 'INDEX' },
                            { type: 'keyword', value: 'PROCEDURE' },
                        ]
                        : []),
                    { type: 'keyword', value: 'TABLE' },
                    { type: 'keyword', value: 'VIEW' },
                ],
            },
            add: (token) => {
                statement.type = `ALTER_${token.value.toUpperCase()}`;
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createTruncateStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        {
            preCanGoToNext: () => false,
            validation: {
                acceptTokens: [{ type: 'keyword', value: 'TRUNCATE' }],
            },
            add: (token) => {
                statement.type = 'TRUNCATE';
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function createUnknownStatementParser(options) {
    const statement = createInitialStatement();
    const steps = [
        {
            preCanGoToNext: () => false,
            add: (token) => {
                statement.type = 'UNKNOWN';
                if (statement.start < 0) {
                    statement.start = token.start;
                }
            },
            postCanGoToNext: () => true,
        },
    ];
    return stateMachineStatementParser(statement, steps, options);
}
function stateMachineStatementParser(statement, steps, { isStrict, dialect }) {
    let currentStepIndex = 0;
    let prevToken;
    let prevPrevToken;
    let lastBlockOpener;
    let anonBlockStarted = false;
    let openBlocks = 0;
    /* eslint arrow-body-style: 0, no-extra-parens: 0 */
    const isValidToken = (step, token) => {
        if (!step.validation) {
            return true;
        }
        return (step.validation.acceptTokens.filter((accept) => {
            const isValidType = token.type === accept.type;
            const isValidValue = !accept.value || token.value.toUpperCase() === accept.value;
            return isValidType && isValidValue;
        }).length > 0);
    };
    const setPrevToken = (token) => {
        prevPrevToken = prevToken;
        prevToken = token;
    };
    return {
        getStatement() {
            return statement;
        },
        addToken(token) {
            /* eslint no-param-reassign: 0 */
            if (statement.endStatement) {
                throw new Error('This statement has already got to the end.');
            }
            if (statement.type &&
                token.type === 'semicolon' &&
                (!statementsWithEnds.includes(statement.type) || (openBlocks === 0 && statement.canEnd))) {
                statement.endStatement = ';';
                return;
            }
            if (token.value.toUpperCase() === 'END') {
                openBlocks--;
                if (openBlocks === 0) {
                    statement.canEnd = true;
                }
                setPrevToken(token);
                return;
            }
            if (token.type === 'whitespace') {
                setPrevToken(token);
                return;
            }
            if (token.type === 'keyword' &&
                blockOpeners[dialect].includes(token.value) &&
                (prevPrevToken === null || prevPrevToken === void 0 ? void 0 : prevPrevToken.value.toUpperCase()) !== 'END') {
                if (['oracle', 'bigquery'].includes(dialect) &&
                    (lastBlockOpener === null || lastBlockOpener === void 0 ? void 0 : lastBlockOpener.value) === 'DECLARE' &&
                    token.value.toUpperCase() === 'BEGIN') {
                    // don't open a new block!
                    setPrevToken(token);
                    lastBlockOpener = token;
                    return;
                }
                openBlocks++;
                lastBlockOpener = token;
                setPrevToken(token);
                if (statement.type === 'ANON_BLOCK' && !anonBlockStarted) {
                    anonBlockStarted = true;
                    // don't return
                }
                else {
                    return;
                }
            }
            if (token.type === 'parameter' &&
                (token.value === '?' || !statement.parameters.includes(token.value))) {
                statement.parameters.push(token.value);
            }
            if (statement.type && statement.start >= 0) {
                // statement has already been identified
                // just wait until end of the statement
                return;
            }
            // index modifiers
            if (token.value.toUpperCase() === 'UNIQUE' ||
                (dialect === 'mysql' && ['FULLTEXT', 'SPATIAL'].includes(token.value.toUpperCase())) ||
                (dialect === 'mssql' && ['CLUSTERED', 'NONCLUSTERED'].includes(token.value.toUpperCase()))) {
                setPrevToken(token);
                return;
            }
            if (['psql', 'mssql'].includes(dialect) && token.value.toUpperCase() === 'MATERIALIZED') {
                setPrevToken(token);
                return;
            }
            // psql allows for optional "OR REPLACE" between "CREATE" and "FUNCTION"
            // mysql and psql allow it between "CREATE" and "VIEW"
            if (['psql', 'mysql', 'bigquery'].includes(dialect) &&
                ['OR', 'REPLACE'].includes(token.value.toUpperCase())) {
                setPrevToken(token);
                return;
            }
            if (['psql', 'sqlite'].includes(dialect) &&
                ['TEMP', 'TEMPORARY'].includes(token.value.toUpperCase())) {
                setPrevToken(token);
                return;
            }
            // MySQL allows for setting a definer for a function which specifies who the function is executed as.
            // This clause is optional, and is defined between the "CREATE" and "FUNCTION" keywords for the statement.
            if (dialect === 'mysql' && token.value.toUpperCase() === 'DEFINER') {
                statement.definer = 0;
                setPrevToken(token);
                return;
            }
            if (statement.definer === 0 && token.value === '=') {
                statement.definer++;
                setPrevToken(token);
                return;
            }
            if (statement.definer !== undefined && statement.definer > 0) {
                if (statement.definer === 1 && prevToken.type === 'whitespace') {
                    statement.definer++;
                    setPrevToken(token);
                    return;
                }
                if (statement.definer > 1 && prevToken.type !== 'whitespace') {
                    setPrevToken(token);
                    return;
                }
                delete statement.definer;
            }
            if (dialect === 'mysql' && token.value.toUpperCase() === 'ALGORITHM') {
                statement.algorithm = 0;
                setPrevToken(token);
                return;
            }
            if (statement.algorithm === 0 && token.value === '=') {
                statement.algorithm++;
                setPrevToken(token);
                return;
            }
            if (statement.algorithm !== undefined && statement.algorithm > 0) {
                if (statement.algorithm === 1 && prevToken.type === 'whitespace') {
                    statement.algorithm++;
                    setPrevToken(token);
                    return;
                }
                if (statement.algorithm > 1 &&
                    ['UNDEFINED', 'MERGE', 'TEMPTABLE'].includes(prevToken.value.toUpperCase())) {
                    setPrevToken(token);
                    return;
                }
                delete statement.algorithm;
            }
            if (dialect === 'mysql' && token.value.toUpperCase() === 'SQL') {
                statement.sqlSecurity = 0;
                setPrevToken(token);
                return;
            }
            if (statement.sqlSecurity !== undefined) {
                if ((statement.sqlSecurity === 0 && token.value.toUpperCase() === 'SECURITY') ||
                    (statement.sqlSecurity === 1 &&
                        ['DEFINER', 'INVOKER'].includes(token.value.toUpperCase()))) {
                    statement.sqlSecurity++;
                    setPrevToken(token);
                    return;
                }
                else if (statement.sqlSecurity === 2) {
                    delete statement.sqlSecurity;
                }
            }
            let currentStep = steps[currentStepIndex];
            if (currentStep.preCanGoToNext(token)) {
                currentStepIndex++;
                currentStep = steps[currentStepIndex];
            }
            if (currentStep.validation &&
                currentStep.validation.requireBefore &&
                !currentStep.validation.requireBefore.includes(prevToken.type)) {
                const requireds = currentStep.validation.requireBefore.join(' or ');
                throw new Error(`Expected any of these tokens ${requireds} before "${token.value}" (currentStep=${currentStepIndex}).`);
            }
            if (!isValidToken(currentStep, token) && isStrict) {
                const expecteds = currentStep.validation
                    ? currentStep.validation.acceptTokens
                        .map((accept) => `(type="${accept.type}" value="${accept.value}")`)
                        .join(' or ')
                    : '()';
                throw new Error(`Expected any of these tokens ${expecteds} instead of type="${token.type}" value="${token.value}" (currentStep=${currentStepIndex}).`);
            }
            currentStep.add(token);
            statement.executionType =
                statement.type && exports.EXECUTION_TYPES[statement.type]
                    ? exports.EXECUTION_TYPES[statement.type]
                    : 'UNKNOWN';
            if (currentStep.postCanGoToNext(token)) {
                currentStepIndex++;
            }
            setPrevToken(token);
        },
    };
}