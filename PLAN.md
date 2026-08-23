OVERARCHING GOAL
Build an aesthetically pleasing, user friendly web application that allows the average homeowner to see when the most energy efficient time to run their appliances is. 

RATIONALE
Many are aware of the climate crisis, but either feel powerless when it comes to making an impact or the ways to make a meaningful impact seem too out of reach. 

The environmental impact of running appliances actually varies temporally. Think about it. During the day most people are at work: their house lights are off, the microwave isnt running, BUT this is the most optimal time for solar! By the time families get back to their house, its evening, the sun starts to set, and the grid changes from solar dependency to gas plants!

Many people are either not aware of this, or aware but unsure of how to act. 

The goal of this website is to empower people in such a way that they know the reduction of environmental impacts they are making. By connecting publicly available electrical grid API's, predictions about future energy usage (based on historical averages), can provide insight into potential CO2 reductions. 

STEPS

Data
- carbon intensity of the grid right now (g of CO2/kWh)
- a forecast of that number for the next week (this is what makes the app useful, so people know when the best date/time to run would be)
- grid region: can likely be estimated by zipcode 

APIs
There are a few options. Please try to use all to the best of your ability. 

- EIA API v2 - free, API key, hourly mWh by fuel type per balancing authority. there is no forcast, but the idea is to average over the past year to get a picture of what this year's usage might look like
- Electricity Maps - precomputed intensity numbers
WattTime - gives a percentile index of dirtiest to cleanest

Workflow
1. use zip or lat/longitude to identify location
2. pull the fuel mix: use the EIA data to make an estimate from the past year (with a higher emphasis on recent data due to changes in grid distribution; this should be update every day as new data gets released). 
3. multiply each fuel's MWh by its emissions factor. this should result in a clear grams of CO2/energy unit 
4. build a forecast. many states wont have forecast data, so the best best is to use estimates of historical averages based on time (most important) and date.
5. present a window of time: dishwashers/washing machines, etc. run for 1-2 hours. give a block of time of when would be most sustainable
6. say one sentence  saying you released X% less CO2 (in a smaller font in parentheses put the grams of CO2 originally and how much it decreased to)
7. Allow users to track their improvements. Using Supabase, allow users to see their total efforts combined as they reduce their CO2 impact little by little. 

CONSIDERATIONS
The app should of course include the personal temporal reduction strategy. This means the user should be able to input what type of appliance/electrical thing they want to run (from a dropdown menu) and the app returns the block of time that would be best

the app should also include tips on how to reduce energy usage like turning off the lights etc. and allow users to log those successes as well.

every week, the app should report a summary of how much CO2 was reduced as a result

ensure the app presents users with a few time blocks, in case one does not work. the different time blocks should say like X% saved, Y% saved, Z% saved 

the user should be able to decline any of those, which is OKAY! it just wont count towards or against their reductions. 

the goal of the app is to EMPOWER! not put down. 

Please feel free to include any other information on the app

please deploy on local host first, and then we can set up supabase and vercel

NON-NEGOTIABLES

UI + UX: the app needs to be very very easy to navigate. it should be attio-style--simple. but it should also be fun and interactive! it should encouarge the users, meaning nice animations, colors, etc. would be a plus in order to make their experience better. It should not be too overwhelming.

Should be very simple to use

Deploy subagents to work on adjacent tasks. have one larger agent oversee and approve

if you have any questions ask me
