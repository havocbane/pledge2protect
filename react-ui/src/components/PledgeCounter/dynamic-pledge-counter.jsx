import React, { useState, useEffect } from 'react';
import axios from 'axios';

import PledgeCounter from './pledge-counter';


const PLEDGE_GOAL = 1338404;

const DynamicPledgeCounter = () => {
    const [pledgeCount, setPledgeCount] = useState(0);

    useEffect(() => {
        const getPledgeCount = async () => {
            const response = await axios.get('/pledge/count');
            if (response && response.data && response.data.pledges) {
                setPledgeCount(response.data.pledges);
            }
        }

        // fetch the pledges on mount
        getPledgeCount();

        // then keep fetching them on an interval after that
        let timer = setInterval(getPledgeCount, 3000);

        return () => clearInterval(timer);
    }, []);

    return (
        <PledgeCounter pledgesCount={pledgeCount} pledgesGoal={PLEDGE_GOAL} />
    );
};

export default DynamicPledgeCounter;
