const EventEmitter = require('events');
class ParallelBenchmark extends EventEmitter
{
    constructor(name, opts)
    {
        super();
        this.name = name;
        this.parallel = opts.parallel || 10;
        this.requests = opts.requests || 1000;
        this.setup = opts.setup;
        this.fn = opts.fn;
        this.verify = opts.verify || function(data) {};
        this.onStart = opts.onStart;
        this.onComplete = opts.onComplete;

        this._fnContext = {};
        this._workerCount = 0;
        this._completedCount = 0;
    }

    run()
    {
        if (this.onStart)
            this.onStart.call(this._fnContext, this);
        else
            this.emit('start', this);

        return this.setup.call(this._fnContext)
        .then(() => {
            this.startTime = new Date().getTime();
            return this.runTasks();
        })
        .then(() => {
            const ops = parseInt(this._completedCount * 1000 / this.elapsedTime, 10);
            const stat = {
                name: this.name,
                ops: ops,
                elapsed: this.elapsedTime,
                completed: this._completedCount
            };
            if (this.onComplete)
                this.onComplete.call(this._fnContext, stat);
            else
                this.emit('complete', stat);

            return stat;
        });
    }

    runTask()
    {
        this._workerCount++;
        return this.fn.apply(this._fnContext)
        .then((data) => {
            this.verify(data);
            this._completedCount++;
            this._workerCount--;
            if (this._completedCount >= this.requests)
            {
                this.elapsedTime = (new Date().getTime()) - this.startTime;
                return this._completedCount;
            }
            if (this._workerCount < this.parallel)
            {
                return this.runTask();
            }
        });
    }

    runTasks()
    {
        const promises = [];
        for (let i = 0; i < this.parallel; i++)
            promises.push(this.runTask());
        return Promise.all(promises);
    }
}

module.exports = ParallelBenchmark;
