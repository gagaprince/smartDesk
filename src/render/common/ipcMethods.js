export default {
    logRender: (str, type = 'log') => {
        console[type](`from-server:---${str}`);
    },
};
