const tap = require('tap');
const fastify = require('fastify')();
const err = require('http-errors');

const esso = require('.');

fastify.register(require('fastify-cookie'));
fastify.register(esso({ secret: '11111111111111111111', extra_validation: null }));

fastify.get('/', (req, reply) => reply.send({ ok: true }));

/** @param { import('fastify').FastifyInstance } fastify */
async function privateRoutes(fastify){
    fastify.requireAuthentication(fastify);

    fastify.get('/test', (req, reply) => reply.send(req.auth));
}

fastify.register(privateRoutes);

tap.test(`builder parameters`, [], builder_parameters);
tap.test(`public requests don't need auth`, [], public_requests_dont_need_auth);
tap.test(`generateAuthToken`, [], generateAuthToken);
tap.test(`private requests need auth`, [], private_requests_need_auth);
tap.test(`extra validation`, [], extra_validation);
tap.test(`disable headers`, [], disable_headers);
tap.test(`disable query`, [], disable_query);
tap.test(`disable cookies`, [], disable_cookies);


/** @param { tap } tap */
async function builder_parameters(tap){
    await fastify.ready();

    tap.rejects(async () => esso(), 'secret cannot be null');
    tap.rejects(async () => esso({ secret: null }), 'secret cannot be null');
    tap.rejects(async () => esso({ secret: '1' }), 'secret should have at least 20 characters');
    tap.rejects(async () => esso({ secret: '1'.repeat(20), header_name: null }), 'header_name cannot be null');
    tap.rejects(async () => esso({ secret: '1'.repeat(20), header_name: 123 }), 'header_name should be a string');
    tap.rejects(async () => esso({ secret: '1'.repeat(20), extra_validation: 123 }), 'extra_validation should either be null or a function');
    tap.rejects(async () => esso({ secret: '1'.repeat(20), disable_headers: true, disable_query: true, disable_cookies: true }), 'disabling both headers, query and cookies should throw');

    tap.resolves(async () => esso({ secret: '1'.repeat(20) }), 'valid settings should not throw');
    tap.resolves(async () => esso({ secret: '1'.repeat(20), header_name: 'x-auth' }), 'valid settings should not throw');
    tap.resolves(async () => esso({ secret: '1'.repeat(20), extra_validation: async () => {} }), 'valid settings should not throw');
}


/** @param { tap } tap */
async function public_requests_dont_need_auth(tap){
    await fastify.ready();

    let { body } = await fastify.inject({ method: 'GET', url: '/' });
    body = JSON.parse(body);

    tap.same(body, { ok: true });
}


/** @param { tap } tap */
async function generateAuthToken(tap){
    await fastify.ready();

    tap.resolveMatch(() => fastify.generateAuthToken(), 'Bearer ', 'generateAuthToken() should return valid token');
    tap.resolveMatch(() => fastify.generateAuthToken({ }), 'Bearer ', 'generateAuthToken({ }) should return valid token');
    tap.resolveMatch(() => fastify.generateAuthToken({ a: 1 }), 'Bearer ', 'generateAuthToken({ a: 1 }) should return valid token');

    const a = await fastify.generateAuthToken();
    const b = await fastify.generateAuthToken();

    tap.strictNotSame(a, b, 'generated tokens should always be different');
}


/** @param { tap } tap */
async function private_requests_need_auth(tap){
    await fastify.ready();

    let response;

    response = await fastify.inject({ method: 'GET', url: '/test' });
    tap.same(JSON.parse(response.body), {
        statusCode: 401,         
        error: 'Unauthorized',   
        message: 'Unauthorized',
    }, `requests with no token should return 401`);

    response = await fastify.inject({ method: 'GET', url: '/test', headers: { authorization: '13543125132' } });
    tap.same(JSON.parse(response.body), {
        statusCode: 403,         
        error: 'Forbidden',   
        message: 'Forbidden',
    }, `requests with invalid token (does not contain 'Bearer') should return 403`);

    response = await fastify.inject({ method: 'GET', url: '/test', headers: { authorization: 'bacon 13543125132' } });
    tap.same(JSON.parse(response.body), {
        statusCode: 403,         
        error: 'Forbidden',   
        message: 'Forbidden',
    }, `requests with invalid token (does not contain 'Bearer') should return 403`);

    response = await fastify.inject({ method: 'GET', url: '/test', headers: { authorization: 'Bearer fake123' } });
    tap.same(JSON.parse(response.body), {
        statusCode: 403,         
        error: 'Forbidden',   
        message: 'Forbidden',
    }, `requests with invalid token (not encrypted) should return 403`);

    response = await fastify.inject({ method: 'GET', url: '/test', headers: { authorization: await fastify.generateAuthToken() } });
    tap.same(JSON.parse(response.body), {}, `requests with valid tokens generated by fastify.generateAuthToken() should have req.auth = {}`);
    
    response = await fastify.inject({ method: 'GET', url: '/test', headers: { authorization: await fastify.generateAuthToken({ a: 1 }) } });
    tap.same(JSON.parse(response.body), { a: 1 }, `requests with valid tokens generated by fastify.generateAuthToken({ a: 1 }) should have req.auth = { a: 1 }`);

    response = await fastify.inject({ method: 'GET', url: '/test?authorization=' + (await fastify.generateAuthToken({ a: 1 })) });
    tap.same(JSON.parse(response.body), { a: 1 }, `requests with valid tokens passed via query strings should work`);

    response = await fastify.inject({ method: 'GET', url: '/test', cookies: { authorization: await fastify.generateAuthToken({ a: 1 }) } });
    tap.same(JSON.parse(response.body), { a: 1 }, `requests with valid tokens passed via cookies should work`);
}


/** @param { tap } tap */
async function extra_validation(tap){
    const fastify = require('fastify')();

    /**
     * @param { import('fastify').FastifyRequest } req  fastify request
     * @param { import('fastify').FastifyReply } reply  fastify reply
     */
    async function validation (req, reply){
        if(req.auth.id > 10)
            throw new err.Forbidden('extra validation failed');
    }

    fastify.register(esso({ secret: '11111111111111111111', extra_validation: validation }));

    /** @param { import('fastify').FastifyInstance } fastify */
    async function privateRoutes(fastify){
        fastify.requireAuthentication(fastify);

        fastify.get('/test', (req, reply) => reply.send(req.auth));
    }

    fastify.register(privateRoutes);

    await fastify.ready();

    let response;

    response = await fastify.inject({ method: 'GET', url: '/test', headers: { authorization: await fastify.generateAuthToken({ id: 15 }) } });
    tap.same(JSON.parse(response.body), {
        statusCode: 403,         
        error: 'Forbidden',   
        message: 'extra validation failed',
    }, `extra validation should fail as expected`);

    response = await fastify.inject({ method: 'GET', url: '/test', headers: { authorization: await fastify.generateAuthToken({ id: 3 }) } });
    tap.same(JSON.parse(response.body), { id: 3 }, `requests with valid tokens generated by fastify.generateAuthToken({ id: 3 }) should have req.auth = { id: 3 }`);
}

/** @param { tap } tap */
async function disable_headers(tap){
    const fastify = require('fastify')();

    fastify.register(esso({ secret: '11111111111111111111', disable_headers: true }));

    /** @param { import('fastify').FastifyInstance } fastify */
    async function privateRoutes(fastify){
        fastify.requireAuthentication(fastify);

        fastify.get('/test', (req, reply) => reply.send(req.auth));
    }

    fastify.register(privateRoutes);

    await fastify.ready();

    let response;

    response = await fastify.inject({ method: 'GET', url: '/test', headers: { authorization: await fastify.generateAuthToken({ id: 15 }) } });
    tap.same(JSON.parse(response.body), {
        statusCode: 401,         
        error: 'Unauthorized',   
        message: 'Unauthorized',
    }, `headers should have been disabled successfully`);
}

/** @param { tap } tap */
async function disable_query(tap){
    const fastify = require('fastify')();

    fastify.register(esso({ secret: '11111111111111111111', disable_query: true }));

    /** @param { import('fastify').FastifyInstance } fastify */
    async function privateRoutes(fastify){
        fastify.requireAuthentication(fastify);

        fastify.get('/test', (req, reply) => reply.send(req.auth));
    }

    fastify.register(privateRoutes);

    await fastify.ready();

    let response;

    response = await fastify.inject({ method: 'GET', url: '/test?authorization=' + (await fastify.generateAuthToken({ id: 15 })) });
    tap.same(JSON.parse(response.body), {
        statusCode: 401,         
        error: 'Unauthorized',   
        message: 'Unauthorized',
    }, `query params should have been disabled successfully`);
}

/** @param { tap } tap */
async function disable_cookies(tap){
    const fastify = require('fastify')();

    fastify.register(esso({ secret: '11111111111111111111', disable_cookies: true }));

    /** @param { import('fastify').FastifyInstance } fastify */
    async function privateRoutes(fastify){
        fastify.requireAuthentication(fastify);

        fastify.get('/test', (req, reply) => reply.send(req.auth));
    }

    fastify.register(privateRoutes);

    await fastify.ready();

    let response;

    response = await fastify.inject({ method: 'GET', url: '/test', cookies: { authorization: await fastify.generateAuthToken({ id: 15 }) } });
    tap.same(JSON.parse(response.body), {
        statusCode: 401,         
        error: 'Unauthorized',   
        message: 'Unauthorized',
    }, `cookies should have been disabled successfully`);
}