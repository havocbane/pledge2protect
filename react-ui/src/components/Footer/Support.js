import React from 'react';
// import { Link } from 'react-router-dom';


const Support = () => (
    <div className="support-contacts">
        <div className="questions">
            <h2 className="about-us-header">Questions?</h2>
            <p className="about-us-body">
                <a
                    className="about-us-links"
                    href="mailto:info@visitmaine.com"
                    aria-label="Contact Us"
                >
                    info@visitmaine.com
                </a>
            </p>
        </div>
        <div className="support">
            <h2 className="about-us-header">Support</h2>
            <p className="about-us-body">
                <a
                    className="about-us-links"
                    href="mailto:dave@pledgetoprotectme.org"
                    aria-label="Contact Us"
                >
                    dave@pledgetoprotectme.org
                </a>
            </p>
        </div>
    </div>
);

export default Support;
